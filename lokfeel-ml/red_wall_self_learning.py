#!/usr/bin/env python3
"""
LokFeel Self-Learning Neural Network System
红墙计划 3500 数字用户自主学习训练

使用 Tinygrad 构建神经网络，让种子用户自我进化，更贴近真实用户。
"""

from __future__ import annotations
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from pathlib import Path
import json
from datetime import datetime
from typing import Optional

# Tinygrad imports
from tinygrad import Tensor
import tinygrad.nn as tnn
import tinygrad.nn.state as nn_state

# LokFeel ML imports
from lokfeel_ml.training import Trainer
from lokfeel_ml.models.evolution_engine import EvolutionEngine
from lokfeel_ml.models.user_embedding import UserEmbeddingModel
from lokfeel_ml.models.match_predictor import MatchOutcomePredictor
from lokfeel_ml.models.behavior_generator import BehaviorGenerator
from lokfeel_ml.data import DataExtractor, FeatureEngine


class RedWallSelfLearningSystem:
    """
    红墙计划自主学习系统
    
    目标：让 3500 个种子数字用户通过神经网络训练，
    自我进化为更贴近真实用户的"数字分身"
    
    训练流程：
    1. 加载红墙计划用户数据
    2. 提取用户特征向量
    3. 训练用户嵌入模型（自编码器）
    4. 训练匹配预测模型
    5. 训练行为生成模型（VAE）
    6. 在线学习适应（UCB/Thompson Sampling）
    7. 保存进化状态到数据库
    """
    
    def __init__(
        self,
        embedding_dim: int = 64,
        batch_size: int = 128,
        epochs: int = 50,
        learning_rate: float = 0.001,
        save_dir: str = "./models/red_wall",
    ):
        self.embedding_dim = embedding_dim
        self.batch_size = batch_size
        self.epochs = epochs
        self.learning_rate = learning_rate
        self.save_dir = Path(save_dir)
        self.save_dir.mkdir(parents=True, exist_ok=True)
        
        # 训练器
        self.trainer = Trainer(
            embedding_dim=embedding_dim,
            lr=learning_rate,
            batch_size=batch_size,
            epochs=epochs,
        )
        
        # 训练统计
        self.stats = {
            "total_users": 0,
            "training_start": None,
            "training_end": None,
            "embedding_loss": [],
            "match_loss": [],
            "behavior_loss": [],
            "evolution_metrics": {},
        }
    
    def load_red_wall_data(self, db_url: Optional[str] = None) -> dict:
        """
        加载红墙计划数据
        
        支持两种模式：
        1. 数据库模式：连接 PostgreSQL 加载 3500 用户
        2. 文件模式：从 JSON 文件加载数据
        
        Returns:
            dict: 包含 features, profiles, match_pairs, interaction_logs
        """
        print("=" * 60)
        print("Loading Red Wall Plan Data (3500 Digital Users)")
        print("=" * 60)
        
        # 尝试从数据库加载
        if db_url or os.environ.get("DATABASE_URL"):
            try:
                return self._load_from_database(db_url)
            except Exception as e:
                print(f"[Warning] Database load failed: {e}")
                print("[Info] Falling back to synthetic data...")
        
        # 从合成数据文件加载（红墙计划预生成数据）
        synthetic_file = self.save_dir / "red_wall_profiles.json"
        if synthetic_file.exists():
            return self._load_from_file(synthetic_file)
        
        # 生成红墙计划合成数据（用于演示）
        print("[Info] Generating synthetic Red Wall data for training...")
        return self._generate_synthetic_red_wall_data()
    
    def _load_from_database(self, db_url: Optional[str] = None) -> dict:
        """从 PostgreSQL 数据库加载红墙计划数据"""
        try:
            import psycopg2
        except ImportError:
            print("[Warning] psycopg2 not installed. Install with: pip install psycopg2-binary")
            raise ImportError("psycopg2 required for database connection")
        
        conn = psycopg2.connect(db_url or os.environ["DATABASE_URL"])
        cursor = conn.cursor()
        
        # 查询红墙计划用户（botType = SEED/TRAINING 的 BotProfile）
        cursor.execute("""
            SELECT 
                p.id, p.user_id, p.name, p.bio, p.age, p.gender,
                p.sexuality, p.relationship_goal, p.attachment_style,
                p.communication_style, p.conflict_resolution, p.love_language,
                p.emotional_availability, p.activity_level, p.city,
                p.interests, p.hobbies,
                bp.total_interactions, bp.successful_matches, bp.avg_engagement_score,
                bp.learning_data
            FROM "BotProfile" bp
            JOIN "Profile" p ON bp."profileId" = p.id
            WHERE bp."botType" IN ('SEED', 'TRAINING', 'ACTIVE')
            ORDER BY bp."totalInteractions" DESC
            LIMIT 3500
        """)
        
        profiles = []
        for row in cursor.fetchall():
            profile = {
                "user_id": row[1],
                "name": row[2],
                "bio": row[3],
                "age": row[4],
                "gender": row[5],
                "sexuality": row[6],
                "relationship_goal": row[7],
                "attachment_style": row[8],
                "communication_style": row[9],
                "conflict_resolution": row[10],
                "love_language": row[11],
                "emotional_availability": row[12],
                "activity_level": row[13],
                "city": row[14],
                "interests": row[15],
                "hobbies": row[16],
                "total_interactions": row[17],
                "successful_matches": row[18],
                "avg_engagement_score": row[19],
                "learning_data": json.loads(row[20]) if row[20] else {},
            }
            profiles.append(profile)
        
        cursor.close()
        conn.close()
        
        print(f"[Database] Loaded {len(profiles)} Red Wall users")
        
        # 提取特征
        features = []
        for profile in profiles:
            feat = FeatureEngine.profile_to_features(profile)
            features.append(feat)
        
        features = np.array(features, dtype=np.float32)
        
        # 生成模拟交互日志（用于训练）
        interaction_logs = self._generate_interaction_logs(profiles)
        
        # 生成匹配对
        match_pairs = self._generate_match_pairs(len(profiles))
        
        return {
            "profiles": profiles,
            "features": features,
            "match_pairs": match_pairs,
            "interaction_logs": interaction_logs,
        }
    
    def _load_from_file(self, file_path: Path) -> dict:
        """从 JSON 文件加载红墙计划数据"""
        with open(file_path, "r") as f:
            data = json.load(f)
        
        profiles = data["profiles"]
        features = np.array(data["features"], dtype=np.float32)
        
        print(f"[File] Loaded {len(profiles)} Red Wall users from {file_path}")
        
        interaction_logs = self._generate_interaction_logs(profiles)
        match_pairs = self._generate_match_pairs(len(profiles))
        
        return {
            "profiles": profiles,
            "features": features,
            "match_pairs": match_pairs,
            "interaction_logs": interaction_logs,
        }
    
    def _generate_synthetic_red_wall_data(self) -> dict:
        """
        生成红墙计划合成数据
        
        基于真实用户分布模拟 3500 个数字用户
        """
        np.random.seed(42)  # 可复现性
        
        n_users = 3500
        profiles = []
        
        # 人口统计分布（模拟真实分布）
        age_dist = np.random.normal(28, 6, n_users).clip(18, 55)
        gender_dist = np.random.choice(["MALE", "FEMALE", "OTHER"], n_users, p=[0.45, 0.48, 0.07])
        
        # 依恋风格分布（参考真实约会数据）
        attachment_dist = np.random.choice(
            ["SECURE", "ANXIOUS", "AVOIDANT", "FEARFUL"],
            n_users, p=[0.50, 0.20, 0.20, 0.10]
        )
        
        # 关系目标
        goal_dist = np.random.choice(
            ["LONG_TERM", "DATING", "FRIENDSHIP", "NOT_SURE", "UNSPECIFIED"],
            n_users, p=[0.35, 0.40, 0.10, 0.10, 0.05]
        )
        
        for i in range(n_users):
            profile = {
                "user_id": f"redwall_{i+1:04d}",
                "name": f"Digital User {i+1}",
                "age": int(age_dist[i]),
                "gender": gender_dist[i],
                "sexuality": np.random.choice(["STRAIGHT", "GAY", "LESBIAN", "BISEXUAL", "OTHER"]),
                "relationship_goal": goal_dist[i],
                "attachment_style": attachment_dist[i],
                "communication_style": np.random.choice(["DIRECT", "MIXED", "RESERVED", "EXPRESSIVE"]),
                "conflict_resolution": np.random.choice(["COLLABORATE", "COMPETITION", "COMPROMISE", "AVOIDANCE", "ACCOMMODATION"]),
                "love_language": np.random.choice(["WORDS", "TOUCH", "GIFTS", "TIME", "ACTS"]),
                "emotional_availability": np.random.choice(["HIGH", "MODERATE", "LOW", "VULNERABLE"]),
                "activity_level": np.random.choice(["GHOST", "LOW", "MEDIUM", "HIGH", "FULL"], p=[0.1, 0.2, 0.4, 0.2, 0.1]),
                "city": np.random.choice(["TIER_1", "TIER_2", "TIER_3"], p=[0.3, 0.5, 0.2]),
                "interests": np.random.choice(["music", "sports", "travel", "food", "reading", "gaming", "art", "fitness", "tech", "movies"], 3).tolist(),
                "hobbies": np.random.choice(["hiking", "cooking", "photography", "yoga", "dancing", "writing", "music", "sports", "gaming", "crafts"], 3).tolist(),
                "total_interactions": np.random.poisson(50),
                "successful_matches": 0,
                "avg_engagement_score": np.random.uniform(40, 80),
                "learning_data": {},
            }
            profiles.append(profile)
        
        # 提取特征
        features = []
        for profile in profiles:
            feat = FeatureEngine.profile_to_features(profile)
            features.append(feat)
        features = np.array(features, dtype=np.float32)
        
        # 保存数据文件
        synthetic_file = self.save_dir / "red_wall_profiles.json"
        with open(synthetic_file, "w") as f:
            json.dump({
                "profiles": profiles,
                "features": features.tolist(),
                "generated_at": datetime.now().isoformat(),
            }, f, indent=2)
        
        print(f"[Synthetic] Generated {n_users} Red Wall profiles")
        
        interaction_logs = self._generate_interaction_logs(profiles)
        match_pairs = self._generate_match_pairs(n_users)
        
        return {
            "profiles": profiles,
            "features": features,
            "match_pairs": match_pairs,
            "interaction_logs": interaction_logs,
        }
    
    def _generate_interaction_logs(self, profiles: list) -> list:
        """生成模拟交互日志"""
        logs = []
        for profile in profiles:
            # 根据用户活跃度生成不同数量的交互
            activity_multiplier = {
                "GHOST": 0, "LOW": 5, "MEDIUM": 15, "HIGH": 30, "FULL": 50
            }.get(profile.get("activity_level", "MEDIUM"), 10)
            
            n_interactions = min(activity_multiplier, 50)
            
            for _ in range(n_interactions):
                log = {
                    "bot_id": profile["user_id"],
                    "user_id": f"real_user_{np.random.randint(1, 1000)}",
                    "interaction_type": np.random.choice(["chat_message", "profile_view", "match_accepted", "chat_started"]),
                    "action": np.random.choice(["respond", "initiate", "react", "ignore"]),
                    "outcome": np.random.choice(["success", "neutral", "failed"], p=[0.6, 0.3, 0.1]),
                    "engagement_score": np.random.normal(60, 15),
                    "response_delay": int(np.random.exponential(30)),
                    "match_score": np.random.uniform(50, 95),
                }
                logs.append(log)
        
        return logs
    
    def _generate_match_pairs(self, n_users: int, n_pairs: int = 5000) -> list:
        """生成随机匹配对"""
        pairs = []
        for _ in range(n_pairs):
            idx_a = np.random.randint(0, n_users)
            idx_b = np.random.randint(0, n_users)
            if idx_a != idx_b:
                pairs.append((idx_a, idx_b))
        return pairs
    
    def train(self, data: dict) -> dict:
        """
        执行完整训练流程
        
        Args:
            data: load_red_wall_data() 返回的数据
            
        Returns:
            dict: 训练结果和统计
        """
        print("=" * 60)
        print("Red Wall Self-Learning Neural Network Training")
        print(f"Users: {data['features'].shape[0]}")
        print(f"Features: {data['features'].shape[1]}")
        print(f"Match Pairs: {len(data['match_pairs'])}")
        print(f"Interaction Logs: {len(data['interaction_logs'])}")
        print("=" * 60)
        
        self.stats["training_start"] = datetime.now().isoformat()
        self.stats["total_users"] = data["features"].shape[0]
        
        # 执行训练管道
        results = self.trainer.full_training_pipeline(
            features=data["features"],
            match_pairs=data["match_pairs"],
            interaction_logs=data["interaction_logs"],
            save_dir=str(self.save_dir),
        )
        
        self.stats["training_end"] = datetime.now().isoformat()
        self.stats["embedding_loss"] = results.get("history", {}).get("embedding_loss", [])
        self.stats["match_loss"] = results.get("history", {}).get("match_loss", [])
        self.stats["behavior_loss"] = results.get("history", {}).get("behavior_loss", [])
        
        # 计算进化指标
        self._compute_evolution_metrics()
        
        # 保存红墙计划特定状态
        self._save_red_wall_state()
        
        return {
            "results": results,
            "stats": self.stats,
        }
    
    def _compute_evolution_metrics(self):
        """计算用户进化指标"""
        # 从进化引擎获取策略表现
        evolution_state = self.trainer.evolution_engine.to_json()
        evolution_data = json.loads(evolution_state)
        
        self.stats["evolution_metrics"] = {
            "total_feedback": evolution_data.get("total_feedback", 0),
            "active_strategies": len(evolution_data.get("arms", [])),
            "best_strategy": self._get_best_strategy(evolution_data),
            "learning_progress": self._calculate_learning_progress(evolution_data),
        }
        
        print("\n[Evolution Metrics]")
        for key, value in self.stats["evolution_metrics"].items():
            print(f"  {key}: {value}")
    
    def _get_best_strategy(self, evolution_data: dict) -> str:
        """获取表现最佳的策略"""
        arms = evolution_data.get("arms", [])
        if not arms:
            return "none"
        
        best_arm = max(arms, key=lambda x: x.get("avg_reward", 0))
        return best_arm.get("arm_id", "unknown")
    
    def _calculate_learning_progress(self, evolution_data: dict) -> float:
        """计算学习进度（0-1）"""
        total_pulls = sum(arm.get("pulls", 0) for arm in evolution_data.get("arms", []))
        # 基于探索次数估算学习进度
        max_pulls = self.stats["total_users"] * 10  # 假设每用户需要10次探索
        return min(total_pulls / max_pulls, 1.0)
    
    def _save_red_wall_state(self):
        """保存红墙计划特定状态"""
        state_file = self.save_dir / "red_wall_state.json"
        
        state = {
            "stats": self.stats,
            "evolution_state": self.trainer.evolution_engine.to_json(),
            "model_config": {
                "embedding_dim": self.embedding_dim,
                "batch_size": self.batch_size,
                "epochs": self.epochs,
                "learning_rate": self.learning_rate,
            },
            "saved_at": datetime.now().isoformat(),
        }
        
        with open(state_file, "w") as f:
            json.dump(state, f, indent=2, default=str)
        
        print(f"\n[Red Wall State] Saved to {state_file}")
    
    def evolve_users(self, data: dict, n_iterations: int = 10) -> dict:
        """
        迭代进化用户
        
        多轮训练让用户逐步进化得更真实
        """
        print(f"\n{'=' * 60}")
        print(f"User Evolution - {n_iterations} Iterations")
        print(f"{'=' * 60}")
        
        for iteration in range(n_iterations):
            print(f"\n[Iteration {iteration + 1}/{n_iterations}]")
            
            # 基于当前策略生成新的交互数据
            new_logs = self._generate_evolution_logs(data["profiles"])
            
            # 更新训练数据
            data["interaction_logs"] = data.get("interaction_logs", []) + new_logs
            
            # 增量训练
            results = self.trainer.full_training_pipeline(
                features=data["features"],
                match_pairs=data["match_pairs"],
                interaction_logs=new_logs,
                save_dir=str(self.save_dir / f"iteration_{iteration + 1}"),
            )
            
            # 打印进度
            emb_loss = results.get("embedding", {}).get("final_train_loss", "N/A")
            print(f"  Embedding Loss: {emb_loss}")
        
        return {"iterations": n_iterations, "final_stats": self.stats}
    
    def _generate_evolution_logs(self, profiles: list) -> list:
        """基于进化策略生成交互日志"""
        logs = []
        
        # 获取当前最优策略
        report = self.trainer.evolution_engine.get_strategy_report()
        arms = report.get("arms", [])
        
        if not arms:
            return self._generate_interaction_logs(profiles[:100])  # 默认回退
        
        # 选择表现最好的策略
        best_arm = max(arms, key=lambda x: x.get("win_rate", 0))
        strategy = best_arm.get("arm_id", "balanced_communicator")
        
        print(f"  Using strategy: {strategy}")
        
        # 根据策略调整交互参数
        strategy_configs = {
            "aggressive_explorer": {"n_interactions": 20, "success_rate": 0.7},
            "balanced_communicator": {"n_interactions": 10, "success_rate": 0.5},
            "passive_listener": {"n_interactions": 5, "success_rate": 0.4},
            "playful_teaser": {"n_interactions": 15, "success_rate": 0.6},
            "sincere_connector": {"n_interactions": 12, "success_rate": 0.55},
        }
        
        config = strategy_configs.get(strategy, {"n_interactions": 10, "success_rate": 0.5})
        
        for profile in profiles[:500]:  # 限制每轮处理的用户数
            for _ in range(config["n_interactions"]):
                log = {
                    "bot_id": profile["user_id"],
                    "user_id": f"evolved_user_{np.random.randint(1, 500)}",
                    "interaction_type": np.random.choice(["chat_message", "match_accepted", "chat_started"]),
                    "action": np.random.choice(["respond", "initiate", "react"]),
                    "outcome": "success" if np.random.random() < config["success_rate"] else "neutral",
                    "engagement_score": np.random.normal(65, 12),
                    "response_delay": int(np.random.exponential(25)),
                    "match_score": np.random.uniform(55, 90),
                }
                logs.append(log)
        
        return logs
    
    def get_evolved_profiles(self) -> list:
        """
        获取进化后的用户配置
        
        用于更新数据库中的 BotProfile
        """
        evolution_state = json.loads(self.trainer.evolution_engine.to_json())
        
        # 生成进化后的用户配置
        evolved_configs = []
        for arm in evolution_state.get("arms", []):
            config = {
                "strategy": arm.get("arm_id"),
                "pulls": arm.get("pulls"),
                "avg_reward": arm.get("avg_reward"),
                "win_rate": arm.get("win_rate"),
                "confidence": arm.get("pulls", 0) / max(arm.get("pulls", 1), 1),
            }
            evolved_configs.append(config)
        
        return evolved_configs


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Red Wall Self-Learning Training System")
    parser.add_argument("--db-url", type=str, help="PostgreSQL database URL")
    parser.add_argument("--embedding-dim", type=int, default=64, help="Embedding dimension")
    parser.add_argument("--batch-size", type=int, default=128, help="Batch size")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--evolve-iterations", type=int, default=5, help="Evolution iterations")
    parser.add_argument("--save-dir", type=str, default="./models/red_wall", help="Save directory")
    
    args = parser.parse_args()
    
    # 初始化系统
    system = RedWallSelfLearningSystem(
        embedding_dim=args.embedding_dim,
        batch_size=args.batch_size,
        epochs=args.epochs,
        learning_rate=args.lr,
        save_dir=args.save_dir,
    )
    
    # 加载数据
    data = system.load_red_wall_data(args.db_url)
    
    # 执行训练
    results = system.train(data)
    
    # 执行用户进化
    if args.evolve_iterations > 0:
        system.evolve_users(data, args.evolve_iterations)
    
    # 打印最终结果
    print("\n" + "=" * 60)
    print("Training Complete!")
    print("=" * 60)
    print(f"Total Users: {results['stats']['total_users']}")
    print(f"Training Time: {results['stats']['training_end']}")
    print(f"Model Saved: {args.save_dir}")


if __name__ == "__main__":
    main()
