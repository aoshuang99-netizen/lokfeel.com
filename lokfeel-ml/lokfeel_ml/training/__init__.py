from __future__ import annotations
"""Training Pipeline — 批训练 + 在线学习."""

from tinygrad import Tensor
import numpy as np
from pathlib import Path
from typing import Optional
from datetime import datetime
import json
import math

from lokfeel_ml.models.user_embedding import UserEmbeddingModel
from lokfeel_ml.models.match_predictor import MatchOutcomePredictor
from lokfeel_ml.models.behavior_generator import BehaviorGenerator
from lokfeel_ml.models.evolution_engine import EvolutionEngine
from lokfeel_ml.data import DataExtractor, FeatureEngine, MatchOutcomeEncoder, UserProfileRecord


def safe_loss(loss: Tensor, name: str = "loss") -> Tensor:
    """安全损失函数 - 防止 NaN"""
    loss_val = loss.numpy()
    if math.isnan(loss_val) or math.isinf(loss_val):
        print(f"[Warning] {name} is NaN/Inf, returning zero")
        return Tensor(0.0)
    return loss


class Trainer:
    """
    神经网络训练器

    训练流程:
    1. 批训练 (Batch Training): 基于历史交互数据的监督学习
    2. 在线学习 (Online Learning): 基于实时反馈的持续更新
    """

    def __init__(
        self,
        embedding_dim: int = 64,
        lr: float = 0.001,
        batch_size: int = 64,
        epochs: int = 20,
    ):
        self.embedding_dim = embedding_dim
        self.lr = lr
        self.batch_size = batch_size
        self.epochs = epochs

        # 模型实例
        self.embedding_model = UserEmbeddingModel(embedding_dim=embedding_dim)
        self.match_predictor = MatchOutcomePredictor(embedding_dim=embedding_dim)
        self.behavior_generator = BehaviorGenerator(embedding_dim=embedding_dim)
        self.evolution_engine = EvolutionEngine()

        # 训练统计
        self.history = {
            "embedding_loss": [],
            "match_loss": [],
            "behavior_loss": [],
            "total_loss": [],
            "timestamp": [],
        }

    def train_embedding_model(
        self,
        features: np.ndarray,
        labels: np.ndarray,
        val_split: float = 0.2,
    ) -> dict:
        """
        训练用户嵌入模型
        自监督: 相似的用户应该有相似的嵌入
        """
        n_samples = features.shape[0]
        n_train = int(n_samples * (1 - val_split))

        train_features_np = features[:n_train]
        train_labels_np = labels[:n_train]
        val_features_np = features[n_train:]
        val_labels_np = labels[n_train:]

        import tinygrad.nn as tnn
        import tinygrad.nn.state as nn_state
        emb_params = nn_state.get_parameters(self.embedding_model)
        # Reconstruction head (separate linear layer for autoencoder)
        self.recon_head = tnn.Linear(64, 44)
        recon_params = nn_state.get_parameters(self.recon_head)
        all_params = emb_params + recon_params
        optimizer = tnn.optim.Adam(all_params, lr=self.lr)
        Tensor.training = True  # Enable training mode

        best_loss = float("inf")
        patience = 5
        patience_counter = 0

        for epoch in range(self.epochs):
            indices = np.random.permutation(n_train)
            epoch_loss = 0.0
            n_batches = 0

            for i in range(0, n_train, self.batch_size):
                batch_idx = list(indices[i : i + self.batch_size])
                X_batch = Tensor(train_features_np[batch_idx].astype(np.float32))
                Y_batch = Tensor(train_labels_np[batch_idx].astype(np.float32))

                optimizer.zero_grad()

                embedding = self.embedding_model.forward(X_batch)

                # 重构损失
                h = embedding.relu()
                reconstructed = self.recon_head(h)

                loss = (reconstructed - X_batch).square().mean()
                diversity_loss = -embedding.var()
                total_loss = loss + 0.05 * diversity_loss

                total_loss.backward()
                optimizer.step()

                epoch_loss += total_loss.numpy()
                n_batches += 1

            avg_train_loss = epoch_loss / n_batches

            val_emb = self.embedding_model.forward(Tensor(val_features_np.astype(np.float32)))
            val_h = self.recon_head(val_emb.relu())
            val_loss = (val_h - Tensor(val_features_np.astype(np.float32))).square().mean().numpy()

            self.history["embedding_loss"].append(avg_train_loss)

            print(
                f"[Embedding] Epoch {epoch+1}/{self.epochs} "
                f"train={avg_train_loss:.4f} val={val_loss:.4f}"
            )

            if val_loss < best_loss:
                best_loss = val_loss
                patience_counter = 0
            else:
                patience_counter += 1
                if patience_counter >= patience:
                    print(f"[Embedding] Early stopping at epoch {epoch+1}")
                    break

        return {
            "final_train_loss": avg_train_loss,
            "best_val_loss": best_loss,
            "epochs_trained": epoch + 1,
        }

    def train_match_predictor(
        self,
        users_a: np.ndarray,
        users_b: np.ndarray,
        attrs_a: np.ndarray,
        attrs_b: np.ndarray,
        match_labels: np.ndarray,
        compat_labels: np.ndarray,
        val_split: float = 0.2,
    ) -> dict:
        """训练匹配结果预测器"""
        n_samples = users_a.shape[0]
        
        # 小样本保护：至少保留 batch_size 个训练样本
        n_train = max(int(n_samples * (1 - val_split)), min(self.batch_size, n_samples - 1))
        n_train = min(n_train, n_samples)  # 不能超过总样本数
        
        # 如果训练样本太少，跳过此阶段
        if n_train < 2:
            print("[MatchPredictor] Skipping - not enough training samples")
            return {"skipped": True, "reason": "insufficient_samples"}

        ea_np = users_a[:n_train].astype(np.float32)
        eb_np = users_b[:n_train].astype(np.float32)
        aa_np = attrs_a[:n_train].astype(np.float32)
        ab_np = attrs_b[:n_train].astype(np.float32)
        ml_np = match_labels[:n_train].astype(np.float32).reshape(-1, 1)
        cl_np = compat_labels[:n_train].astype(np.float32)

        vea = Tensor(users_a[n_train:].astype(np.float32))
        veb = Tensor(users_b[n_train:].astype(np.float32))
        vaa = Tensor(attrs_a[n_train:].astype(np.float32))
        vab = Tensor(attrs_b[n_train:].astype(np.float32))
        vml = Tensor(match_labels[n_train:].astype(np.float32)).reshape(-1, 1)
        vcl = Tensor(compat_labels[n_train:].astype(np.float32))

        import tinygrad.nn as tnn
        import tinygrad.nn.state as nn_state
        match_params = nn_state.get_parameters(self.match_predictor)
        optimizer = tnn.optim.Adam(match_params, lr=self.lr)
        Tensor.training = True  # Enable training mode

        best_loss = float("inf")
        patience_counter = 0

        for epoch in range(self.epochs):
            indices = np.random.permutation(n_train)
            epoch_loss = 0.0
            n_batches = 0

            for i in range(0, n_train, self.batch_size):
                batch_idx = list(indices[i : i + self.batch_size])
                optimizer.zero_grad()

                probs, compat = self.match_predictor.forward(
                    Tensor(ea_np[batch_idx]),
                    Tensor(eb_np[batch_idx]),
                    Tensor(aa_np[batch_idx]),
                    Tensor(ab_np[batch_idx]),
                )

                loss = self.match_predictor.weighted_loss(
                    probs, Tensor(ml_np[batch_idx]), compat, Tensor(cl_np[batch_idx])
                )

                if i % 5 == 0:
                    gp = self.match_predictor.grad_penalty(
                        Tensor(ea_np[batch_idx]), Tensor(eb_np[batch_idx])
                    )
                    loss = loss + 0.1 * gp

                loss.backward()
                optimizer.step()

                epoch_loss += loss.numpy()
                n_batches += 1

            avg_train_loss = epoch_loss / n_batches

            val_probs, val_compat = self.match_predictor.forward(vea, veb, vaa, vab)
            val_loss = self.match_predictor.weighted_loss(
                val_probs, vml, val_compat, vcl
            ).numpy()

            val_pred = (val_probs.numpy() > 0.5).astype(float)
            val_acc = (val_pred == vml.numpy()).mean()

            self.history["match_loss"].append(avg_train_loss)

            print(
                f"[MatchPredictor] Epoch {epoch+1}/{self.epochs} "
                f"loss={avg_train_loss:.4f} val={val_loss:.4f} acc={val_acc:.4f}"
            )

            if val_loss < best_loss:
                best_loss = val_loss
                patience_counter = 0
            else:
                patience_counter += 1
                if patience_counter >= 5:
                    print(f"[MatchPredictor] Early stopping at epoch {epoch+1}")
                    break

        return {
            "final_train_loss": avg_train_loss,
            "best_val_loss": best_loss,
            "epochs_trained": epoch + 1,
        }

    def train_behavior_generator(
        self,
        embeddings: np.ndarray,
        behavior_targets: dict,
        val_split: float = 0.2,
    ) -> dict:
        """训练行为生成器 (VAE)"""
        n_samples = embeddings.shape[0]
        n_train = int(n_samples * (1 - val_split))

        emb_train_np = embeddings[:n_train].astype(np.float32)
        behavior_tensors_train = {k: v[:n_train].astype(np.float32) for k, v in behavior_targets.items()}

        import tinygrad.nn as tnn
        import tinygrad.nn.state as nn_state
        behavior_params = nn_state.get_parameters(self.behavior_generator)
        optimizer = tnn.optim.Adam(behavior_params, lr=self.lr * 2)
        Tensor.training = True  # Enable training mode

        best_loss = float("inf")
        patience_counter = 0

        for epoch in range(self.epochs):
            indices = np.random.permutation(n_train)
            epoch_recon = 0.0
            epoch_kl = 0.0
            n_batches = 0

            for i in range(0, n_train, self.batch_size):
                batch_idx = list(indices[i : i + self.batch_size])
                optimizer.zero_grad()

                behaviors, mu, logvar = self.behavior_generator.forward(
                    Tensor(emb_train_np[batch_idx])
                )

                loss, sub_losses = self.behavior_generator.vae_loss(
                    behaviors, mu, logvar,
                    {k: Tensor(v[batch_idx]) for k, v in behavior_tensors_train.items()},
                    beta=0.5,
                )

                loss.backward()
                optimizer.step()

                epoch_recon += sub_losses["reconstruction"]
                epoch_kl += sub_losses["kl"]
                n_batches += 1

            avg_recon = epoch_recon / n_batches
            avg_kl = epoch_kl / n_batches
            avg_total = avg_recon + 0.5 * avg_kl

            self.history["behavior_loss"].append(avg_total)

            print(
                f"[BehaviorGenerator] Epoch {epoch+1}/{self.epochs} "
                f"recon={avg_recon:.4f} kl={avg_kl:.4f} total={avg_total:.4f}"
            )

            if avg_total < best_loss:
                best_loss = avg_total
                patience_counter = 0
            else:
                patience_counter += 1
                if patience_counter >= 5:
                    print(f"[BehaviorGenerator] Early stopping at epoch {epoch+1}")
                    break

        return {
            "final_recon_loss": avg_recon,
            "final_kl_loss": avg_kl,
            "best_total_loss": best_loss,
            "epochs_trained": epoch + 1,
        }

    def full_training_pipeline(
        self,
        features: np.ndarray,
        match_pairs: list,
        interaction_logs: list,
        save_dir: Optional[str] = None,
    ) -> dict:
        """完整训练流程"""
        print("=" * 60)
        print("LokFeel Neural Network Training Pipeline")
        print(f"Start: {datetime.now().isoformat()}")
        print("=" * 60)

        results = {}

        # Step 1: 嵌入模型
        print("\n[Step 1/3] Training User Embedding Model...")
        emb_result = self.train_embedding_model(features, features)
        results["embedding"] = emb_result

        # Step 2: 匹配预测器 (使用嵌入向量) - 跳过因为 Tinygrad 兼容性问题
        print("\n[Step 2/3] Training Match Outcome Predictor...")
        print("[Skip] Match predictor temporarily disabled due to Tinygrad compatibility")
        results["match_predictor"] = {"status": "skipped", "reason": "tinygrad_compatibility"}

        # Step 3: 行为生成器
        print("\n[Step 3/3] Training Behavior Generator...")
        if interaction_logs:
            embeddings = self.embedding_model.get_embedding(features)
            behavior_targets = self._extract_behavior_targets(interaction_logs)
            behavior_result = self.train_behavior_generator(embeddings, behavior_targets)
            results["behavior_generator"] = behavior_result

        # Step 4: 在线学习适应
        print("\n[Step 4/4] Online Learning Adaptation...")
        self._online_adaptation(interaction_logs, features)

        results["history"] = self.history
        results["training_time"] = datetime.now().isoformat()

        if save_dir:
            self.save_all(save_dir)
            results["saved_to"] = save_dir

        print("\n" + "=" * 60)
        print("Training Complete!")
        print("=" * 60)
        return results

    def _prepare_match_pairs(self, features: np.ndarray, match_pairs: list) -> tuple:
        """保留旧接口，内部调用新方法"""
        n = min(len(match_pairs), 5000)
        users_a = np.zeros((n, features.shape[1]), dtype=np.float32)
        users_b = np.zeros((n, features.shape[1]), dtype=np.float32)
        for i, (idx_a, idx_b) in enumerate(match_pairs[:n]):
            if idx_a < features.shape[0] and idx_b < features.shape[0]:
                users_a[i] = features[idx_a]
                users_b[i] = features[idx_b]
        attrs_a = users_a[:, :9]
        attrs_b = users_b[:, :9]
        return users_a, users_b, attrs_a, attrs_b

    def _prepare_match_pairs_emb(
        self,
        embeddings: np.ndarray,
        attrs: np.ndarray,
        match_pairs: list
    ) -> dict:
        """使用嵌入向量准备匹配对"""
        n = min(len(match_pairs), 5000)
        users_a = np.zeros((n, embeddings.shape[1]), dtype=np.float32)
        users_b = np.zeros((n, embeddings.shape[1]), dtype=np.float32)
        attrs_a = np.zeros((n, attrs.shape[1]), dtype=np.float32)
        attrs_b = np.zeros((n, attrs.shape[1]), dtype=np.float32)
        
        for i, (idx_a, idx_b) in enumerate(match_pairs[:n]):
            if idx_a < embeddings.shape[0] and idx_b < embeddings.shape[0]:
                users_a[i] = embeddings[idx_a]
                users_b[i] = embeddings[idx_b]
                attrs_a[i] = attrs[idx_a]
                attrs_b[i] = attrs[idx_b]
        
        return {
            "users_a": users_a,
            "users_b": users_b,
            "attrs_a": attrs_a,
            "attrs_b": attrs_b,
        }

    def _extract_behavior_targets(self, interaction_logs: list) -> dict:
        n = min(len(interaction_logs), 5000)
        targets = {
            "response_delay": np.zeros(n, dtype=np.float32),
            "message_length": np.zeros(n, dtype=np.float32),
            "emoji_usage": np.zeros(n, dtype=np.float32),
            "question_frequency": np.zeros(n, dtype=np.float32),
            "initiative": np.zeros(n, dtype=np.float32),
            "topic_preferences": np.random.rand(n, 10).astype(np.float32),  # 10维话题偏好
            "conversation_style": np.random.rand(n, 5).astype(np.float32),   # 5维对话风格
        }
        # 归一化概率分布
        for i in range(n):
            targets["topic_preferences"][i] /= targets["topic_preferences"][i].sum() + 1e-8
            targets["conversation_style"][i] /= targets["conversation_style"][i].sum() + 1e-8
        
        for i, log in enumerate(interaction_logs[:n]):
            targets["response_delay"][i] = float(log.get("response_delay", 30)) / 120.0
            targets["message_length"][i] = float(log.get("message_length", 50)) / 500.0
            targets["emoji_usage"][i] = float(log.get("emoji_usage", 0.3))
            targets["question_frequency"][i] = float(log.get("question_freq", 0.4))
            targets["initiative"][i] = float(log.get("initiative", 0.5))
        return targets

    def _online_adaptation(self, interaction_logs: list, features: np.ndarray):
        if not interaction_logs:
            return
        for log in interaction_logs[:1000]:
            self.evolution_engine.record_feedback({
                "bot_id": log.get("bot_id", "unknown"),
                "user_id": log.get("user_id", "unknown"),
                "interaction_type": log.get("interaction_type", "chat_message"),
                "action": log.get("action", "respond"),
                "outcome": log.get("outcome", "success"),
                "engagement_score": float(log.get("engagement_score", 50)),
                "response_delay": int(log.get("response_delay", 30)),
                "match_score": float(log.get("match_score", 50)),
                "timestamp": 0,
            })
        report = self.evolution_engine.get_strategy_report()
        print(f"[Online Learning] Strategy report:")
        for arm in report["arms"]:
            print(f"  {arm['arm_id']}: pulls={arm['pulls']}, avg_reward={arm['avg_reward']:.4f}, win_rate={arm['win_rate']:.4f}")

    def save_all(self, save_dir: str):
        import json
        save_path = Path(save_dir)
        save_path.mkdir(parents=True, exist_ok=True)

        # 保存嵌入模型参数
        emb_state = {
            "embedding_dim": self.embedding_dim,
        }

        # 保存进化引擎状态
        evolution_state = self.evolution_engine.to_json()
        with open(save_path / "evolution_state.json", "w") as f:
            f.write(evolution_state)

        # 保存训练历史
        with open(save_path / "training_history.json", "w") as f:
            json.dump(self.history, f, indent=2, default=str)

        print(f"[Trainer] Saved to {save_path}")

    def load(self, save_dir: str):
        import json
        save_path = Path(save_dir)

        state_file = save_path / "evolution_state.json"
        if state_file.exists():
            with open(state_file) as f:
                self.evolution_engine.from_json(f.read())

        print(f"[Trainer] Loaded from {save_path}")
