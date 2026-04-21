from __future__ import annotations

"""
BehaviorGenerator — Tinygrad Neural Network
基于用户嵌入生成真实的 Bot 行为序列

行为空间:
  - response_delay: 响应延迟 (0-120分钟)  → 回归
  - message_length: 消息长度 (10-500字)   → 回归
  - emoji_usage: emoji 使用概率 (0-1)       → sigmoid
  - question_frequency: 提问频率 (0-1)     → sigmoid
  - initiativ_level: 主动程度 (0-1)        → sigmoid
  - topic_preferences: 话题偏好 (10维)     → softmax
  - conversation_style: 对话风格 (5维)     → softmax
"""

from tinygrad import Tensor, nn
import numpy as np
from typing import Optional, Any


def binary_cross_entropy(pred: Tensor, target: Tensor) -> Tensor:
    """Binary cross entropy loss — implemented manually for Tinygrad compatibility."""
    eps = 1e-7
    pred = pred.clip(eps, 1 - eps)
    return -(target * pred.log() + (1 - target) * (1 - pred).log()).mean()

class BehaviorGenerator:
    """
    VAE-style Behavior Generator
    给定用户嵌入, 生成该用户与其他 Bot/真人交互时的行为参数

    Encoder: 用户嵌入 → 行为潜在变量
    Decoder: 潜在变量 + 上下文 → 具体行为
    """

    def __init__(self, embedding_dim: int = 64, latent_dim: int = 32, num_topics: int = 10):
        self.embedding_dim = embedding_dim
        self.latent_dim = latent_dim
        self.num_topics = num_topics

        # === Encoder: 嵌入 → 潜在变量分布参数 (使用 LayerNorm 替代 BatchNorm) ===
        self.enc_fc1 = nn.Linear(embedding_dim, 64)
        self.enc_ln1 = nn.LayerNorm(64)
        self.enc_fc_mu = nn.Linear(64, latent_dim)      # 均值
        self.enc_fc_logvar = nn.Linear(64, latent_dim)   # 对数方差

        # === Decoder: 潜在变量 → 行为参数 ===
        # 输入: latent(32) + context(embedding)(64) = 96
        self.dec_fc1 = nn.Linear(latent_dim + embedding_dim, 64)
        self.dec_ln1 = nn.LayerNorm(64)

        # 行为输出头
        # 回归任务
        self.head_response_delay = nn.Linear(64, 1)   # 输出 raw, 后面 sigmoid
        self.head_message_length = nn.Linear(64, 1)

        # 二分类 (sigmoid)
        self.head_emoji_usage = nn.Linear(64, 1)
        self.head_question_freq = nn.Linear(64, 1)
        self.head_initiative = nn.Linear(64, 1)

        # 多分类 (softmax)
        self.head_topics = nn.Linear(64, num_topics)
        self.head_style = nn.Linear(64, 5)

    def encode(self, embedding: Tensor) -> tuple[Tensor, Tensor]:
        """Encoder: 嵌入 → μ, log(σ²)"""
        h = self.enc_fc1(embedding)
        h = self.enc_ln1(h)
        h = h.gelu()

        mu = self.enc_fc_mu(h)
        logvar = self.enc_fc_logvar(h)
        return mu, logvar

    def reparameterize(self, mu: Tensor, logvar: Tensor) -> Tensor:
        """重参数化技巧: z = μ + σ * ε"""
        std = (logvar * 0.5).exp()
        eps = Tensor.randn(std.shape)
        return mu + std * eps

    def decode(self, z: Tensor, context: Tensor) -> dict[str, Tensor]:
        """Decoder: 潜在变量 + 上下文 → 行为参数"""
        x = Tensor.cat(z, context, dim=1)  # Tinygrad: unpack args

        h = self.dec_fc1(x)
        h = self.dec_ln1(h)
        h = h.gelu()

        # 回归任务 (输出到指定范围)
        response_delay = (self.head_response_delay(h).sigmoid() * 120).relu()   # 0-120分钟
        message_length = (self.head_message_length(h).sigmoid() * 490 + 10).relu()  # 10-500字

        # 二分类任务
        emoji_usage = self.head_emoji_usage(h).sigmoid()
        question_freq = self.head_question_freq(h).sigmoid()
        initiative = self.head_initiative(h).sigmoid()

        # 多分类任务 (归一化)
        topic_logits = self.head_topics(h)
        topic_probs = topic_logits.softmax(axis=1)

        style_logits = self.head_style(h)
        style_probs = style_logits.softmax(axis=1)

        return {
            "response_delay": response_delay,
            "message_length": message_length,
            "emoji_usage": emoji_usage,
            "question_frequency": question_freq,
            "initiative": initiative,
            "topic_preferences": topic_probs,
            "conversation_style": style_probs,
        }

    def forward(
        self,
        embedding: Tensor,
        context: Tensor | None = None,
    ) -> tuple[dict[str, Tensor], Tensor, Tensor]:
        """
        前向传播 (VAE 模式)
        embedding: (batch, 64) 用户嵌入
        context: (batch, 64) 可选的上下文嵌入 (对方用户)
        """
        if context is None:
            context = embedding  # 自编码模式

        mu, logvar = self.encode(embedding)
        z = self.reparameterize(mu, logvar)
        behaviors = self.decode(z, context)

        return behaviors, mu, logvar

    def generate(
        self,
        embedding: np.ndarray,
        context: Optional[np.ndarray] = None,
    ) -> dict[str, np.ndarray]:
        """
        Python 调用接口: 生成行为参数
        返回离散的行为字典 (非 Tensor)
        """
        emb = Tensor(embedding.astype(np.float32))
        ctx = Tensor(context.astype(np.float32)) if context is not None else None

        behaviors, _, _ = self.forward(emb, ctx)

        result = {}
        for k, v in behaviors.items():
            result[k] = v.numpy()  # Tinygrad Tensor 直接支持 .numpy()
        return result

    def vae_loss(
        self,
        behaviors: dict[str, Tensor],
        mu: Tensor,
        logvar: Tensor,
        true_behaviors: dict[str, Tensor],
        beta: float = 1.0,
    ) -> tuple[Tensor, dict]:
        """
        VAE 损失 = 重构损失 + β * KL 散度
        beta > 1: 更强正则化 (disentanglement)
        """
        losses = {}

        # 重构损失
        recon_loss = Tensor(0.0)
        recon_loss = recon_loss + (behaviors["response_delay"] - true_behaviors["response_delay"]).square().mean()
        recon_loss = recon_loss + (behaviors["message_length"] - true_behaviors["message_length"]).square().mean()
        recon_loss = recon_loss + binary_cross_entropy(behaviors["emoji_usage"], true_behaviors["emoji_usage"])
        recon_loss = recon_loss + binary_cross_entropy(behaviors["question_frequency"], true_behaviors["question_frequency"])
        recon_loss = recon_loss + binary_cross_entropy(behaviors["initiative"], true_behaviors["initiative"])
        recon_loss = recon_loss + binary_cross_entropy(behaviors["topic_preferences"].softmax(), true_behaviors["topic_preferences"].softmax())
        recon_loss = recon_loss + binary_cross_entropy(behaviors["conversation_style"].softmax(), true_behaviors["conversation_style"].softmax())

        losses["reconstruction"] = recon_loss.numpy()

        # KL 散度: KL(N(μ,σ) || N(0,1))
        kl_loss = -0.5 * (1 + logvar - mu.square() - logvar.exp()).mean()
        losses["kl"] = kl_loss.numpy()

        total_loss = recon_loss + beta * kl_loss
        return total_loss, losses


class BehaviorSynthesizer:
    """
    行为合成器: 结合多个行为模型生成最终行为
    用于混合不同 Bot 的行为特征
    """

    def __init__(self, num_models: int = 3):
        self.num_models = num_models

        # 每个子模型的混合权重 (可学习)
        self.mixture_weights = Tensor.ones(num_models).log_softmax().exp()

    def mix_behaviors(
        self,
        behaviors_list: list[dict[str, np.ndarray]],
    ) -> dict[str, np.ndarray]:
        """
        加权混合多个行为模型输出的行为
        behaviors_list: 每个元素的结构和 BehaviorGenerator.generate() 返回值相同
        """
        if len(behaviors_list) == 0:
            return {}
        if len(behaviors_list) == 1:
            return behaviors_list[0]

        keys = behaviors_list[0].keys()
        result = {}

        for key in keys:
            tensors = [Tensor(b[key]) for b in behaviors_list]
            weights = self.mixture_weights[: len(tensors)].reshape(-1, 1)
            # 归一化权重
            weights = weights / weights.sum()
            # 加权平均
            mixed = sum(w * t for w, t in zip(weights.tolist(), [t.numpy() for t in tensors]))
            if key in ["topic_preferences", "conversation_style"]:
                # 概率分布: 再次 softmax
                result[key] = mixed.softmax(axis=1)
            else:
                result[key] = mixed
            result[key] = result[key].numpy()

        return result
