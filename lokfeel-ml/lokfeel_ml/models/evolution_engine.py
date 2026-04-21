from __future__ import annotations
"""
EvolutionEngine — 在线学习引擎
基于真实用户反馈,持续更新 Bot 行为参数

使用以下在线学习策略:
  1. UCB1 (Upper Confidence Bound) — 平衡探索/利用
  2. Thompson Sampling — 贝叶斯策略选择
  3. Exponential Moving Average — 反馈平滑
  4. Gradient Descent — Tinygrad 自动微分参数更新
"""

from tinygrad import Tensor
import numpy as np
from collections import deque
import json
from typing import TypedDict

class BotFeedback(TypedDict):
    bot_id: str
    user_id: str
    interaction_type: str  # "match_received" | "message_sent" | "chat_quality"
    action: str            # "accept" | "pass" | "respond" | "block"
    outcome: str            # "success" | "rejected" | "no_response"
    engagement_score: float  # 0-100
    response_delay: int     # seconds
    match_score: float      # 原始匹配分 0-100
    timestamp: float        # Unix timestamp


class EvolutionEngine:
    """
    Bot 在线进化引擎
    核心算法:
    - UCB1: 策略选择 (探索/利用平衡)
    - EMA: 反馈平滑 (降低噪声影响)
    - Gradient Descent: 参数更新 (Tinygrad)
    """

    # 行为策略变体 (不同的 Bot 行为配置)
    STRATEGY_ARMS = [
        {
            "id": "aggressive_explorer",
            "response_delay_range": (5, 30),
            "emoji_prob": 0.8,
            "question_freq": 0.6,
            "initiative": 0.9,
            "description": "快速响应 + 高emoji + 高主动",
        },
        {
            "id": "balanced_communicator",
            "response_delay_range": (15, 60),
            "emoji_prob": 0.4,
            "question_freq": 0.4,
            "initiative": 0.5,
            "description": "均衡型,响应较慢,内容驱动",
        },
        {
            "id": "passive_listener",
            "response_delay_range": (60, 120),
            "emoji_prob": 0.2,
            "question_freq": 0.5,
            "initiative": 0.3,
            "description": "慢响应,少emoji,引导对方表达",
        },
        {
            "id": "playful_teaser",
            "response_delay_range": (30, 90),
            "emoji_prob": 0.9,
            "question_freq": 0.3,
            "initiative": 0.7,
            "description": "高emoji,调皮风格,问少量问题",
        },
        {
            "id": "sincere_connector",
            "response_delay_range": (20, 45),
            "emoji_prob": 0.15,
            "question_freq": 0.7,
            "initiative": 0.6,
            "description": "真诚型,少emoji但认真提问",
        },
    ]

    def __init__(self, num_arms: int = 5, alpha: float = 0.1):
        """
        num_arms: 策略变体数量
        alpha: EMA 平滑系数 (越小越平滑,对噪声越不敏感)
        """
        self.num_arms = num_arms
        self.alpha = alpha
        self.arms = self.STRATEGY_ARMS[:num_arms]

        # UCB1 统计
        self.arm_stats = [
            {
                "pulls": 0,
                "rewards": [],
                "avg_reward": 0.0,
                "ema_reward": 0.0,  # 指数移动平均
                "ucb": float("inf"),
                # Beta 分布参数 (for Thompson Sampling)
                "beta_alpha": 1.0,
                "beta_beta": 1.0,
            }
            for _ in range(num_arms)
        ]

        # 历史反馈缓存 (用于训练)
        self.feedback_history: deque[BotFeedback] = deque(maxlen=10000)

        # Bot 策略分配
        self.bot_strategies: dict[str, int] = {}  # bot_id → arm_index

        # 参数学习率 (用于梯度下降更新)
        self.behavior_params = Tensor.randn(num_arms, 5, requires_grad=True)
        self.learning_rate = 0.01

    def select_arm_ucb1(self, bot_id: str | None = None) -> int:
        """
        UCB1 算法选择策略臂
        公式: avg_reward + sqrt(2 * ln(total_pulls) / arm_pulls)
        """
        total_pulls = sum(s["pulls"] for s in self.arm_stats)

        if total_pulls == 0:
            # 冷启动: 均匀随机
            return np.random.randint(0, self.num_arms)

        best_arm = 0
        best_ucb = -float("inf")

        for i, stats in enumerate(self.arm_stats):
            if stats["pulls"] == 0:
                ucb = float("inf")  # 未探索的臂优先
            else:
                exploration = np.sqrt(2 * np.log(total_pulls) / stats["pulls"])
                ucb = stats["avg_reward"] + exploration

            if ucb > best_ucb:
                best_ucb = ucb
                best_arm = i

            self.arm_stats[i]["ucb"] = ucb

        return best_arm

    def select_arm_thompson(self) -> int:
        """
        Thompson Sampling — Beta 分布贝叶斯采样
        适合二值奖励场景 (接受/拒绝)
        """
        samples = []
        for stats in self.arm_stats:
            # 从 Beta 分布采样
            alpha = stats["beta_alpha"]
            beta = stats["beta_beta"]
            sample = self._beta_sample(alpha, beta)
            samples.append(sample)

        return int(np.argmax(samples))

    def _beta_sample(self, alpha: float, beta: float) -> float:
        """从 Beta 分布采样 (使用 Gamma 分布近似)"""
        import math

        def gamma_sample(shape: float, scale: float = 1.0) -> float:
            # Marsaglia & Tsang 快速 Gamma 采样
            if shape < 1:
                return gamma_sample(1 + shape, scale) * (np.random.random() ** (1 / shape))

            d = shape - 1 / 3
            c = 1 / np.sqrt(9 * d)
            while True:
                x = np.random.normal()
                v = (1 + c * x) ** 3
                if v > 0:
                    u = np.random.random()
                    if u < 1 - 0.0331 * (x ** 4):
                        return d * v * scale
                    if np.log(u) < 0.5 * x ** 2 + d * (1 - v + np.log(v)):
                        return d * v * scale

        x = gamma_sample(alpha)
        y = gamma_sample(beta)
        return x / (x + y + 1e-10)

    def assign_strategy(self, bot_id: str, method: str = "ucb1") -> dict:
        """
        为 Bot 分配策略臂
        method: "ucb1" | "thompson" | "random"
        """
        if method == "thompson":
            arm_idx = self.select_arm_thompson()
        elif method == "random":
            arm_idx = np.random.randint(0, self.num_arms)
        else:
            arm_idx = self.select_arm_ucb1(bot_id)

        self.bot_strategies[bot_id] = arm_idx
        return self.arms[arm_idx]

    def record_feedback(self, feedback: BotFeedback):
        """记录反馈数据"""
        self.feedback_history.append(feedback)

        bot_id = feedback["bot_id"]
        arm_idx = self.bot_strategies.get(bot_id, 0)

        # 计算奖励信号
        reward = self._compute_reward(feedback)

        # 更新 UCB1 统计
        stats = self.arm_stats[arm_idx]
        stats["pulls"] += 1
        stats["rewards"].append(reward)

        # 增量更新平均值
        n = stats["pulls"]
        stats["avg_reward"] = (stats["avg_reward"] * (n - 1) + reward) / n

        # EMA 更新
        if stats["ema_reward"] == 0:
            stats["ema_reward"] = reward
        else:
            stats["ema_reward"] = self.alpha * reward + (1 - self.alpha) * stats["ema_reward"]

        # Beta 分布参数更新
        if reward >= 0.5:
            stats["beta_alpha"] += reward * 0.1
        else:
            stats["beta_beta"] += (1 - reward) * 0.1

        # 限制历史长度
        if len(stats["rewards"]) > 200:
            stats["rewards"] = stats["rewards"][-200:]

    def _compute_reward(self, feedback: BotFeedback) -> float:
        """
        计算奖励信号 (0-1)
        综合: engagement_score + match_outcome + response_delay
        """
        reward = feedback["engagement_score"] / 100.0  # 归一化到 [0,1]

        # match outcome 加权
        outcome_weights = {"success": 1.0, "rejected": 0.0, "no_response": 0.3}
        outcome_bonus = outcome_weights.get(feedback["outcome"], 0.0)
        reward = reward * 0.7 + outcome_bonus * 0.3

        # 响应延迟惩罚 (太快或太慢都是异常)
        delay = feedback["response_delay"]
        if delay < 300:  # 5分钟内
            delay_penalty = 0.0
        elif delay < 1800:  # 30分钟内
            delay_penalty = 0.0
        else:
            delay_penalty = min(0.3, (delay - 1800) / 3600 * 0.3)
        reward = max(0, reward - delay_penalty)

        return reward

    def online_gradient_update(self, embeddings: Tensor, target_actions: Tensor) -> float:
        """
        Tinygrad 自动微分在线梯度更新
        基于最近的反馈历史,更新行为参数

        embeddings: (batch, 64) 用户嵌入
        target_actions: (batch, 5) 目标行为参数 (one-hot style + continuous)
        """
        if len(self.feedback_history) < 10:
            return 0.0

        # 构造训练批次
        batch_size = min(32, len(self.feedback_history))
        recent = list(self.feedback_history)[-batch_size:]

        # 简化: 用嵌入均值作为特征
        features = embeddings[:batch_size]
        targets = target_actions[:batch_size]

        # 前向: 简单的线性映射
        logits = features @ self.behavior_params

        # 损失: MSE
        loss = (logits - targets).square().mean()

        # 反向传播
        loss.backward()

        # 手动梯度下降更新
        with Tensor.no_grad():
            grad = self.behavior_params.grad
            if grad is not None:
                self.behavior_params.assign(
                    self.behavior_params - self.learning_rate * grad
                )

        return loss.cpu().numpy()

    def get_strategy_report(self) -> dict:
        """
        生成策略表现报告
        """
        report = {
            "total_arms": self.num_arms,
            "total_feedback": len(self.feedback_history),
            "arms": [],
        }

        for i, (arm, stats) in enumerate(zip(self.arms, self.arm_stats)):
            arm_report = {
                "arm_id": arm["id"],
                "description": arm["description"],
                "pulls": stats["pulls"],
                "avg_reward": round(stats["avg_reward"], 4),
                "ema_reward": round(stats["ema_reward"], 4),
                "beta_alpha": round(stats["beta_alpha"], 2),
                "beta_beta": round(stats["beta_beta"], 2),
                "ucb": round(stats["ucb"], 4),
                "win_rate": (
                    round(stats["beta_alpha"] / (stats["beta_alpha"] + stats["beta_beta"]), 4)
                    if (stats["beta_alpha"] + stats["beta_beta"]) > 0
                    else 0.5
                ),
            }
            report["arms"].append(arm_report)

        return report

    def evolve_bot_personality(
        self,
        bot_id: str,
        interaction_outcome: float,  # -1 到 1
        personality_vector: np.ndarray,  # (5,) 维度: 开放性/尽责性/外向性/宜人性/神经质
    ) -> np.ndarray:
        """
        基于交互结果进化 Bot 人格向量
        使用 Hebbian 学习规则: "neurons that fire together wire together"

        interaction_outcome: 交互结果 (-1 负面, 0 中性, 1 正面)
        personality_vector: 当前人格向量 (5维, -1 到 1)
        返回: 更新后的人格向量
        """
        # 学习率: 随交互次数递减
        n_interactions = len([f for f in self.feedback_history if f["bot_id"] == bot_id])
        learning_rate = 0.1 / (1 + n_interactions * 0.05)

        # Hebbian 更新规则
        # Δw = η * x * y
        delta = learning_rate * interaction_outcome

        # 进化方向: 正反馈 → 增强当前人格特征, 负反馈 → 抑制
        updated = personality_vector + delta * personality_vector

        # 边界约束
        updated = np.clip(updated, -1.0, 1.0)

        return updated

    def to_json(self) -> str:
        """序列化引擎状态"""
        return json.dumps({
            "num_arms": self.num_arms,
            "arm_stats": [
                {
                    "pulls": s["pulls"],
                    "rewards": s["rewards"][-50:],  # 只保存最近50条
                    "avg_reward": s["avg_reward"],
                    "ema_reward": s["ema_reward"],
                    "beta_alpha": s["beta_alpha"],
                    "beta_beta": s["beta_beta"],
                }
                for s in self.arm_stats
            ],
            "bot_strategies": self.bot_strategies,
        }, indent=2)

    def from_json(self, data: str):
        """从 JSON 反序列化"""
        state = json.loads(data)
        self.num_arms = state["num_arms"]
        for i, s in enumerate(state["arm_stats"]):
            if i < len(self.arm_stats):
                self.arm_stats[i].update(s)
        self.bot_strategies = state.get("bot_strategies", {})
