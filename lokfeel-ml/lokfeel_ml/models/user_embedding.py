from __future__ import annotations

"""
UserEmbeddingModel — Tinygrad Neural Network
将用户画像(profile)映射到 64 维稠密向量空间

输入特征 (47维):
  - 年龄 (1维, normalized 0-1)
  - 性别 (2维, one-hot: MALE/FEMALE/OTHER)
  - 性取向 (5维, one-hot)
  - 关系目标 (4维, one-hot)
  - 依恋风格 (4维, one-hot)
  - 沟通风格 (4维, one-hot)
  - 冲突解决 (5维, one-hot)
  - 爱的语言 (5维, one-hot)
  - 情感可用性 (4维, one-hot)
  - 兴趣爱好 (5维, normalized count)
  - 活跃度 (1维, normalized)
  - 城市类型 (3维, one-hot: 大城市/中等/小城市)
"""

from tinygrad import Tensor, nn
from tinygrad.dtype import dtypes
import numpy as np
from typing import Optional, Any

class UserEmbeddingModel:
    """
    将用户画像编码为 64 维嵌入向量
    使用 3 层全连接网络 + 残差连接
    """

    def __init__(self, input_dim: int = 44, embedding_dim: int = 64, hidden_dims: list = None):
        self.input_dim = input_dim
        self.embedding_dim = embedding_dim
        self.hidden_dims = hidden_dims or [128, 96]

        # 特征标准化层 (可学习 scale + bias)
        self.input_scale = Tensor.randn(1, input_dim).exp()  # 确保正值
        self.input_bias = Tensor.zeros(1, input_dim)

        # 共享特征提取器 (使用 LayerNorm 替代 BatchNorm，更稳定)
        self.fc1 = nn.Linear(input_dim, self.hidden_dims[0])
        self.ln1 = nn.LayerNorm(self.hidden_dims[0])
        self.fc2 = nn.Linear(self.hidden_dims[0], self.hidden_dims[1])
        self.ln2 = nn.LayerNorm(self.hidden_dims[1])
        self.fc3 = nn.Linear(self.hidden_dims[1], embedding_dim)
        self.ln3 = nn.LayerNorm(embedding_dim)

        # 残差映射
        self.residual = nn.Linear(input_dim, embedding_dim)

        # 注意力权重 (用于不同特征维度的重要性)
        self.attention_weights = Tensor.randn(1, input_dim).exp()

        # 嵌入归一化参数
        self.embedding_scale = Tensor.ones(1, embedding_dim) * 0.1
        self.embedding_bias = Tensor.zeros(1, embedding_dim)

    def forward(self, x: Tensor) -> Tensor:
        """
        前向传播
        x: Tensor of shape (batch, 47)
        returns: Tensor of shape (batch, 64)
        """
        # 输入标准化
        x_norm = (x - self.input_bias) * self.input_scale

        # 特征注意力加权
        x_att = x_norm * self.attention_weights

        # 主路径 (LayerNorm 替代 BatchNorm)
        h = x_att.gelu()
        h = self.fc1(h)
        h = self.ln1(h)
        h = h.gelu()

        h = self.fc2(h)
        h = self.ln2(h)
        h = h.gelu()

        h = self.fc3(h)
        h = self.ln3(h)

        # 残差连接 (带投影)
        residual = self.residual(x_att)
        h = h + residual * 0.3  # 残差权重 0.3

        # 输出归一化
        embedding = h * (1 + self.embedding_scale) + self.embedding_bias
        return embedding

    def get_embedding(self, features: np.ndarray) -> np.ndarray:
        """
        Python 调用接口: numpy array → numpy embedding
        features: (batch, 47) numpy array
        """
        x = Tensor(features.astype(np.float32))
        emb = self.forward(x)
        return emb.numpy()  # Tinygrad Tensor 直接支持 .numpy()

    def cosine_similarity(self, emb1: Tensor, emb2: Tensor) -> Tensor:
        """计算两个嵌入向量的余弦相似度"""
        dot = (emb1 * emb2).sum(axis=1, keepdim=True)
        norm1 = emb1.square().sum(axis=1, keepdim=True).sqrt() + 1e-8
        norm2 = emb2.square().sum(axis=1, keepdim=True).sqrt() + 1e-8
        return dot / (norm1 * norm2)

    def euclidean_distance(self, emb1: Tensor, emb2: Tensor) -> Tensor:
        """计算欧氏距离"""
        diff = emb1 - emb2
        return diff.square().sum(axis=1).sqrt()


class EmbeddingCache:
    """
    嵌入向量缓存,避免重复计算
    TTL + LRU 策略
    """

    def __init__(self, max_size: int = 10000, ttl_seconds: int = 3600):
        self.cache = {}
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self.access_order = []

    def get(self, user_id: str) -> Optional[np.ndarray]:
        if user_id not in self.cache:
            return None
        entry = self.cache[user_id]
        if entry["expires_at"] < np.datetime64("now"):
            del self.cache[user_id]
            self.access_order.remove(user_id)
            return None
        # LRU: 移到末尾
        self.access_order.remove(user_id)
        self.access_order.append(user_id)
        return entry["embedding"]

    def put(self, user_id: str, embedding: np.ndarray):
        if len(self.cache) >= self.max_size:
            oldest = self.access_order.pop(0)
            del self.cache[oldest]
        expires_at = np.datetime64("now").astype("datetime64[s]").astype(float) + self.ttl_seconds
        expires_at = np.datetime64(int(expires_at), "s")
        self.cache[user_id] = {
            "embedding": embedding,
            "expires_at": expires_at,
        }
        self.access_order.append(user_id)

    def invalidate(self, user_id: str):
        if user_id in self.cache:
            del self.cache[user_id]
            self.access_order.remove(user_id)

    def clear(self):
        self.cache.clear()
        self.access_order.clear()
