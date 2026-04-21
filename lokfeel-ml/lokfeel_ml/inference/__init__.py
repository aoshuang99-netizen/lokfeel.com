from __future__ import annotations
"""Inference API — 推理服务,供 Next.js 后端调用."""

import json
import numpy as np
from typing import Optional
from dataclasses import dataclass

from lokfeel_ml.models.user_embedding import UserEmbeddingModel, EmbeddingCache
from lokfeel_ml.models.match_predictor import MatchOutcomePredictor
from lokfeel_ml.models.behavior_generator import BehaviorGenerator
from lokfeel_ml.models.evolution_engine import EvolutionEngine
from lokfeel_ml.data import FeatureEngine


@dataclass
class MatchScoreResult:
    """匹配评分结果"""
    match_probability: float       # 0-1
    compatibility_scores: dict     # {attachment: 85, communication: 70, ...}
    recommendation: str           # "STRONG_MATCH" | "POTENTIAL" | "LOW_MATCH"
    reasons: list[str]


@dataclass
class BotBehaviorResult:
    """Bot 行为参数"""
    response_delay_minutes: float
    response_delay_max_minutes: float
    message_length_range: str
    emoji_probability: float
    question_frequency: float
    initiative_level: float
    recommended_style: str
    topic_preferences: list[str]


class LokFeelInference:
    """
    LokFeel 神经网络推理引擎
    供 Next.js API 路由调用

    使用方式:
      inference = LokFeelInference(load_dir="./models")
      result = inference.predict_match(user_a_profile, user_b_profile)
    """

    def __init__(
        self,
        embedding_dim: int = 64,
        load_dir: Optional[str] = None,
    ):
        self.embedding_dim = embedding_dim

        # 模型实例
        self.embedding_model = UserEmbeddingModel(embedding_dim=embedding_dim)
        self.match_predictor = MatchOutcomePredictor(embedding_dim=embedding_dim)
        self.behavior_generator = BehaviorGenerator(embedding_dim=embedding_dim)
        self.evolution_engine = EvolutionEngine()

        # 嵌入缓存
        self.embedding_cache = EmbeddingCache(max_size=10000, ttl_seconds=3600)

        # 话题偏好标签
        self.topic_labels = [
            "outdoor_adventure", "creative_arts", "intellectual_discussion",
            "social_events", "entertainment", "food_dining", "travel",
            "fitness_wellness", "technology", "family_values"
        ]
        self.style_labels = [
            "witty_playful", "deep_thoughtful", "casual_relaxed",
            "romantic_sincere", "adventurous_bold"
        ]

        if load_dir:
            self.load(load_dir)

    def predict_match(
        self,
        profile_a: dict,
        profile_b: dict,
        use_cache: bool = True,
    ) -> MatchScoreResult:
        """
        预测两个用户之间的匹配分数

        profile_a, profile_b: 用户画像字典
        返回 MatchScoreResult
        """
        # 提取特征
        features_a = FeatureEngine.profile_to_features(profile_a)
        features_b = FeatureEngine.profile_to_features(profile_b)
        attrs_a = FeatureEngine.profile_to_basic_attributes(profile_a)
        attrs_b = FeatureEngine.profile_to_basic_attributes(profile_b)

        # 嵌入
        user_id_a = profile_a.get("user_id", "unknown")
        user_id_b = profile_b.get("user_id", "unknown")

        if use_cache:
            emb_a = self.embedding_cache.get(user_id_a)
            emb_b = self.embedding_cache.get(user_id_b)
        else:
            emb_a = emb_b = None

        if emb_a is None:
            emb_a = self.embedding_model.get_embedding(features_a.reshape(1, -1))[0]
            self.embedding_cache.put(user_id_a, emb_a)

        if emb_b is None:
            emb_b = self.embedding_model.get_embedding(features_b.reshape(1, -1))[0]
            self.embedding_cache.put(user_id_b, emb_b)

        # 预测
        probs, compat_scores = self.match_predictor.predict(
            emb_a.reshape(1, -1), emb_b.reshape(1, -1),
            attrs_a.reshape(1, -1), attrs_b.reshape(1, -1),
        )

        match_prob = float(probs[0][0])
        compat = compat_scores[0]

        compat_dict = {
            "attachment": round(float(compat[0]), 1),
            "communication": round(float(compat[1]), 1),
            "conflict_resolution": round(float(compat[2]), 1),
            "values": round(float(compat[3]), 1),
            "lifestyle": round(float(compat[4]), 1),
        }

        # 推荐决策
        if match_prob >= 0.7:
            recommendation = "STRONG_MATCH"
            reasons = ["双方依恋风格高度兼容", "沟通风格互补性强", "关系目标一致"]
        elif match_prob >= 0.4:
            recommendation = "POTENTIAL"
            reasons = ["存在一定兼容性", "建议进一步了解"]
        else:
            recommendation = "LOW_MATCH"
            reasons = ["匹配概率较低", "可能存在价值观差异"]

        return MatchScoreResult(
            match_probability=round(match_prob, 3),
            compatibility_scores=compat_dict,
            recommendation=recommendation,
            reasons=reasons,
        )

    def generate_bot_behavior(
        self,
        bot_profile: dict,
        target_user_profile: Optional[dict] = None,
    ) -> BotBehaviorResult:
        """
        为 Bot 生成行为参数

        bot_profile: Bot 用户画像
        target_user_profile: 目标用户画像 (可选,用于上下文感知)
        """
        features = FeatureEngine.profile_to_features(bot_profile)
        emb = self.embedding_model.get_embedding(features.reshape(1, -1))[0]

        target_emb = None
        if target_user_profile:
            target_features = FeatureEngine.profile_to_features(target_user_profile)
            target_emb = self.embedding_model.get_embedding(target_features.reshape(1, -1))[0]

        behaviors = self.behavior_generator.generate(emb.reshape(1, -1), target_emb.reshape(1, -1) if target_emb is not None else None)

        topic_idx = np.argmax(behaviors["topic_preferences"][0])
        style_idx = np.argmax(behaviors["conversation_style"][0])

        return BotBehaviorResult(
            response_delay_minutes=round(float(behaviors["response_delay"][0][0]), 1),
            response_delay_max_minutes=round(float(behaviors["response_delay"][0][0]) * 1.5, 1),
            message_length_range=f"{int(behaviors['message_length'][0][0] * 0.8)}-{int(behaviors['message_length'][0][0] * 1.2)}",
            emoji_probability=round(float(behaviors["emoji_usage"][0][0]), 2),
            question_frequency=round(float(behaviors["question_frequency"][0][0]), 2),
            initiative_level=round(float(behaviors["initiative"][0][0]), 2),
            recommended_style=self.style_labels[style_idx],
            topic_preferences=self.topic_labels[topic_idx:topic_idx+3],
        )

    def select_bot_strategy(self, bot_id: str, method: str = "ucb1") -> dict:
        """
        为 Bot 选择行为策略 (UCB1 / Thompson Sampling)
        """
        strategy = self.evolution_engine.assign_strategy(bot_id, method)
        return {
            "bot_id": bot_id,
            "strategy_id": strategy["id"],
            "description": strategy["description"],
            "response_delay_range": strategy["response_delay_range"],
            "emoji_prob": strategy["emoji_prob"],
            "question_freq": strategy["question_freq"],
            "initiative": strategy["initiative"],
        }

    def record_and_evolve(
        self,
        feedback: dict,
    ) -> dict:
        """
        记录反馈并触发进化
        返回进化后的人格向量变化
        """
        from lokfeel_ml.models.evolution_engine import BotFeedback

        fb: BotFeedback = {
            "bot_id": feedback["bot_id"],
            "user_id": feedback["user_id"],
            "interaction_type": feedback.get("interaction_type", "chat_message"),
            "action": feedback.get("action", "respond"),
            "outcome": feedback.get("outcome", "success"),
            "engagement_score": float(feedback.get("engagement_score", 50)),
            "response_delay": int(feedback.get("response_delay", 30)),
            "match_score": float(feedback.get("match_score", 50)),
            "timestamp": feedback.get("timestamp", 0),
        }

        self.evolution_engine.record_feedback(fb)

        # 人格向量进化
        personality = np.array(feedback.get("personality_vector", [0.0]*5), dtype=np.float32)
        outcome = fb["engagement_score"] / 100.0 * 2 - 1  # 映射到 -1 到 1
        updated_personality = self.evolution_engine.evolve_bot_personality(
            fb["bot_id"], outcome, personality
        )

        return {
            "bot_id": fb["bot_id"],
            "interaction_recorded": True,
            "personality_vector_before": personality.tolist(),
            "personality_vector_after": updated_personality.tolist(),
            "strategy_report": self.evolution_engine.get_strategy_report(),
        }

    def batch_predict(
        self,
        users: list[dict],
        candidate_pool: list[dict],
        top_n: int = 10,
    ) -> list[dict]:
        """
        批量预测: 给定用户列表和候选池,返回 top-N 最优匹配

        users: 当前用户列表 (from DB)
        candidate_pool: 候选 Bot 用户池
        top_n: 返回前 N 个最优匹配
        """
        results = []

        for user in users:
            scores = []
            for candidate in candidate_pool:
                score = self.predict_match(user, candidate, use_cache=True)
                scores.append({
                    "user_id": user.get("user_id"),
                    "candidate_id": candidate.get("user_id"),
                    "match_probability": score.match_probability,
                    "compatibility": score.compatibility_scores,
                    "recommendation": score.recommendation,
                })

            scores.sort(key=lambda x: x["match_probability"], reverse=True)
            results.extend(scores[:top_n])

        return results

    def get_evolution_report(self) -> dict:
        """获取进化引擎报告"""
        return self.evolution_engine.get_strategy_report()

    def to_json(self) -> str:
        """序列化推理引擎状态"""
        return self.evolution_engine.to_json()

    def save(self, save_dir: str):
        """保存推理引擎状态"""
        from pathlib import Path
        import json

        save_path = Path(save_dir)
        save_path.mkdir(parents=True, exist_ok=True)

        with open(save_path / "inference_state.json", "w") as f:
            f.write(self.to_json())

        print(f"[Inference] Saved to {save_path}")

    def load(self, save_dir: str):
        """加载推理引擎状态"""
        from pathlib import Path
        import json

        save_path = Path(save_dir)
        state_file = save_path / "inference_state.json"

        if state_file.exists():
            with open(state_file) as f:
                self.evolution_engine.from_json(f.read())

        print(f"[Inference] Loaded from {save_path}")
