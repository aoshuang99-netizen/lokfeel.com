from __future__ import annotations

"""
MatchOutcomePredictor — Tinygrad Neural Network
预测两个用户之间的匹配成功概率

输入:
  - 用户A的嵌入向量 (64维)
  - 用户B的嵌入向量 (64维)
  - 两个用户嵌入的逐元素乘积 (64维, 交互特征)
  - 两个用户嵌入的绝对差 (64维, 差异特征)
  - 用户A的基础属性 (10维, 性别/年龄等)
  - 用户B的基础属性 (10维)

输出:
  - 匹配成功概率 (0-1)
  - 各维度兼容性评分 (5维: attachment/communication/conflict/values/lifestyle)
"""

from tinygrad import Tensor, nn
import numpy as np
import tinygrad.helpers as helpers

class Dropout:
    """Simple Dropout layer for Tinygrad"""
    def __init__(self, p: float = 0.5, train: bool = True):
        self.p = p
        self.train = train
        self.mask = None

    def __call__(self, x: Tensor) -> Tensor:
        if not self.train:
            return x
        if self.mask is None or self.mask.shape != x.shape:
            self.mask = Tensor.rand(x.shape) > self.p
        return x * self.mask * (1.0 / (1.0 - self.p))

class MatchOutcomePredictor:
    """
    预测匹配结果的多任务神经网络
    任务1: 二分类 (匹配成功/失败)
    任务2: 多维兼容性评分回归
    """

    def __init__(
        self,
        embedding_dim: int = 64,
        attribute_dim: int = 9,
        hidden_dims: list = None,
        num_tasks: int = 6,  # 1 classification + 5 regression tasks
    ):
        self.embedding_dim = embedding_dim
        self.attribute_dim = attribute_dim  # 添加缺失的属性
        self.num_tasks = num_tasks

        hd = hidden_dims or [128, 64, 32]

        # 交互特征层 (使用 LayerNorm 替代 BatchNorm)
        # 输入: emb_a(64) + emb_b(64) + emb_a*emb_b(64) + |emb_a-emb_b|(64) = 256维
        self.interaction_fc1 = nn.Linear(embedding_dim * 4, hd[0])
        self.interaction_ln1 = nn.LayerNorm(hd[0])
        self.interaction_fc2 = nn.Linear(hd[0], hd[1])
        self.interaction_ln2 = nn.LayerNorm(hd[1])

        # 属性融合层
        # 输入: attr_a(10) + attr_b(10) = 20维
        self.attr_fc1 = nn.Linear(attribute_dim * 2, hd[1] // 2)
        self.attr_ln1 = nn.LayerNorm(hd[1] // 2)

        # 共享编码器
        self.shared_fc1 = nn.Linear(hd[1] + hd[1] // 2, hd[2])
        self.shared_ln1 = nn.LayerNorm(hd[2])
        self.dropout = Dropout(p=0.2, train=True)

        # 任务专用头
        # 任务0: 匹配成功二分类 (sigmoid)
        self.task_heads = []
        for i in range(num_tasks):
            self.task_heads.append(nn.Linear(hd[2], 1))

        # 可学习的任务权重 (用于多任务学习)
        self.task_weights = Tensor.ones(num_tasks).log_softmax().exp()

    def forward(self, emb_a: Tensor, emb_b: Tensor, attr_a: Tensor, attr_b: Tensor):
        """
        前向传播
        emb_a: (batch, 64) - 用户A嵌入
        emb_b: (batch, 64) - 用户B嵌入
        attr_a: (batch, 10) - 用户A基础属性
        attr_b: (batch, 10) - 用户B基础属性
        returns: (match_prob, compatibility_scores)
          match_prob: (batch, 1) - 0到1之间
          compatibility_scores: (batch, 5) - 各维度兼容性评分
        """
        # === 交互特征 ===
        interaction = [
            emb_a,
            emb_b,
            emb_a * emb_b,            # 逐元素乘积 ( Hadamard product )
            (emb_a - emb_b).abs(),    # 绝对差
        ]
        x_inter = Tensor.cat(*interaction, dim=1)

        x_inter = self.interaction_fc1(x_inter)
        x_inter = self.interaction_ln1(x_inter)
        x_inter = x_inter.gelu()

        x_inter = self.interaction_fc2(x_inter)
        x_inter = self.interaction_ln2(x_inter)
        x_inter = x_inter.gelu()

        # === 属性融合 ===
        x_attr = Tensor.cat(attr_a, attr_b, dim=1)  # Tinygrad: unpack args
        x_attr = self.attr_fc1(x_attr)
        x_attr = self.attr_ln1(x_attr)
        x_attr = x_attr.gelu()

        # === 特征融合 ===
        x = Tensor.cat(x_inter, x_attr, dim=1)  # Tinygrad: unpack args

        x = self.shared_fc1(x)
        x = self.shared_ln1(x)
        x = x.gelu()
        x = self.dropout(x)

        # === 任务输出 ===
        match_logit = self.task_heads[0](x)
        match_prob = match_logit.sigmoid()

        # 兼容性评分 (tanh 压缩到 -1 到 1, 然后映射到 0-100)
        compat_scores = []
        for i in range(1, self.num_tasks):
            score = self.task_heads[i](x).tanh()  # [-1, 1]
            compat_scores.append(score)
        compat_scores = Tensor.cat(*compat_scores, dim=1)
        compat_scores = (compat_scores + 1) * 50  # 映射到 [0, 100]

        return match_prob, compat_scores

    def predict(
        self,
        emb_a: np.ndarray,
        emb_b: np.ndarray,
        attr_a: np.ndarray,
        attr_b: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Python 调用接口
        返回: (match_probabilities, compatibility_scores)
        """
        ea = Tensor(emb_a.astype(np.float32))
        eb = Tensor(emb_b.astype(np.float32))
        aa = Tensor(attr_a.astype(np.float32))
        ab = Tensor(attr_b.astype(np.float32))

        probs, compat = self.forward(ea, eb, aa, ab)
        return probs.numpy(), compat.numpy()  # Tinygrad Tensor 直接支持 .numpy()

    def weighted_loss(
        self,
        match_prob: Tensor,
        true_match: Tensor,
        compat_scores: Tensor,
        true_compat: Tensor,
        task_weights: Tensor | None = None,
    ) -> Tensor:
        """
        多任务加权损失 - 极简数值稳定版本
        只用 BCE，避免数值爆炸
        """
        # 数值裁剪防止 log(0)
        eps = 1e-6
        p = match_prob.clip(eps, 1 - eps)
        
        # BCE
        bce = -(true_match * p.log() + (1 - true_match) * (1 - p).log()).mean()
        
        return bce

    def grad_penalty(self, emb_a: Tensor, emb_b: Tensor) -> Tensor:
        """
        梯度惩罚 — 简化为 L2 正则化 (Tinygrad 兼容性)
        """
        # Tinygrad 不支持复杂的梯度计算，简化为 L2 惩罚
        diff = (emb_a - emb_b).square().mean()
        return diff * 0.01  # 小幅度惩罚，鼓励嵌入对齐
