from __future__ import annotations
"""Data Pipeline — 从数据库提取 3500 种子用户 → 特征工程."""

import os
import json
import numpy as np

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    _PSYCOPG2_AVAILABLE = True
except ImportError:
    _PSYCOPG2_AVAILABLE = False
    psycopg2 = None
    RealDictCursor = None
from typing import Optional
from dataclasses import dataclass

# ============================================================
# 特征工程配置
# ============================================================

# 依恋风格编码
ATTACHMENT_STYLES = {
    "Secure": [1, 0, 0, 0],
    "Anxious-Preoccupied": [0, 1, 0, 0],
    "Dismissive-Avoidant": [0, 0, 1, 0],
    "Fearful-Avoidant": [0, 0, 0, 1],
    None: [0, 0, 0, 0],
}

# 沟通风格编码
COMMUNICATION_STYLES = {
    "Direct": [1, 0, 0, 0],
    "Reflective": [0, 1, 0, 0],
    "Expressive": [0, 0, 1, 0],
    "Analytical": [0, 0, 0, 1],
    None: [0, 0, 0, 0],
}

# 冲突解决风格
CONFLICT_RESOLUTION_STYLES = {
    "Collaborative": [1, 0, 0, 0, 0],
    "Compromising": [0, 1, 0, 0, 0],
    "Accommodating": [0, 0, 1, 0, 0],
    "Competing": [0, 0, 0, 1, 0],
    "Avoiding": [0, 0, 0, 0, 1],
    None: [0, 0, 0, 0, 0],
}

# 爱的语言
LOVE_LANGUAGES = {
    "Words of Affirmation": [1, 0, 0, 0, 0],
    "Quality Time": [0, 1, 0, 0, 0],
    "Physical Touch": [0, 0, 1, 0, 0],
    "Acts of Service": [0, 0, 0, 1, 0],
    "Gifts": [0, 0, 0, 0, 1],
    None: [0, 0, 0, 0, 0],
}

# 关系目标
RELATIONSHIP_GOALS = {
    "LONG_TERM": [1, 0, 0, 0],
    "DATING": [0, 1, 0, 0],
    "FRIENDSHIP": [0, 0, 1, 0],
    "NOT_SURE": [0, 0, 0, 1],
}

# 性别
GENDER_ONEHOT = {
    "MALE": [1, 0, 0],
    "FEMALE": [0, 1, 0],
    "NON_BINARY": [0, 0, 1],
    "OTHER": [0, 0, 1],
}

# 性取向
SEXUALITY_ONEHOT = {
    "Straight": [1, 0, 0, 0, 0],
    "Gay": [0, 1, 0, 0, 0],
    "Lesbian": [0, 0, 1, 0, 0],
    "Bisexual": [0, 0, 0, 1, 0],
    "Pansexual": [0, 0, 0, 0, 1],
    None: [0, 0, 0, 0, 0],
}

# 情感可用性
EMOTIONAL_AVAILABILITY = {
    "Fully Available": [1, 0, 0, 0],
    "Building Trust": [0, 1, 0, 0],
    "Processing Past": [0, 0, 1, 0],
    "Needs Space": [0, 0, 0, 1],
    None: [0, 0, 0, 0],
}

# 城市类型
CITY_TYPES = {
    "NEW_YORK": [1, 0, 0],
    "LOS_ANGELES": [1, 0, 0],
    "CHICAGO": [1, 0, 0],
    "SAN_FRANCISCO": [1, 0, 0],
    "AUSTIN": [1, 0, 0],
    "BOSTON": [1, 0, 0],
    "MIAMI": [1, 0, 0],
    "SEATTLE": [1, 0, 0],
    "LARGE_CITY": [1, 0, 0],
    "MEDIUM_CITY": [0, 1, 0],
    "SMALL_CITY": [0, 0, 1],
    None: [0, 0, 1],
}

# 兴趣爱好 → 5 个类别
INTEREST_CATEGORIES = {
    "outdoor": ["hiking", "camping", "running", "cycling", "climbing", "sports", "fitness", "yoga"],
    "creative": ["photography", "writing", "art", "music", "painting", "design", "cooking", "baking"],
    "intellectual": ["reading", "science", "tech", "politics", "history", "philosophy", "podcasts"],
    "social": ["traveling", "networking", "events", "volunteering", "community"],
    "entertainment": ["gaming", "movies", "tv", "netflix", "anime", "concerts", "dancing"],
}


def extract_interest_features(interests: list, hobbies: list) -> list:
    """将兴趣列表映射到 5 维归一化特征向量"""
    all_items = [i.lower() for i in (interests or []) + (hobbies or [])]
    features = []
    for category, keywords in INTEREST_CATEGORIES.items():
        count = sum(1 for item in all_items if any(kw in item for kw in keywords))
        features.append(min(1.0, count / 3.0))
    return features


def city_type(city: str | None) -> list:
    """根据城市名推断城市规模"""
    if city is None:
        return CITY_TYPES[None]
    city_upper = city.upper()
    if city_upper in CITY_TYPES:
        return CITY_TYPES[city_upper]
    if any(w in city_upper for w in ["NEW", "LOS", "SAN", "CHICAGO", "MIAMI", "BOSTON", "SEATTLE"]):
        return CITY_TYPES["LARGE_CITY"]
    return CITY_TYPES["SMALL_CITY"]


@dataclass
class UserProfileRecord:
    """用户画像数据库记录"""
    user_id: str
    bot_id: str | None
    age: int
    gender: str
    sexuality: str | None
    city: str | None
    relationship_goal: str
    attachment_style: str | None
    communication_style: str | None
    conflict_resolution: str | None
    love_language: str | None
    emotional_availability: str | None
    interests: list
    hobbies: list
    personality_data: dict | None
    occupation: str | None
    industry: str | None
    education_level: str | None
    ethnicity: str | None
    activity_level: str | None
    is_bot: bool
    bot_type: str | None
    total_interactions: int
    successful_matches: int


class DataExtractor:
    """从 PostgreSQL 提取种子用户数据"""

    def __init__(self, database_url: str | None = None):
        self.database_url = database_url or os.getenv("DATABASE_URL")
        if not self.database_url:
            raise ValueError("DATABASE_URL environment variable not set")

    def connect(self):
        self.conn = psycopg2.connect(self.database_url)
        self.conn.autocommit = True
        self.cursor = self.conn.cursor(cursor_factory=RealDictCursor)

    def close(self):
        if hasattr(self, "cursor"):
            self.cursor.close()
        if hasattr(self, "conn"):
            self.conn.close()

    def fetch_seed_users(self, limit: int = 3500) -> list[UserProfileRecord]:
        """提取所有种子用户 + BotProfile"""
        query = """
            SELECT
                u.id as user_id,
                u.is_bot,
                u.bot_type,
                p.age,
                p.gender,
                p.sexuality,
                p.city,
                p.relationship_goal,
                p.attachment_style,
                p.communication_style,
                p.conflict_resolution,
                p.love_language,
                p.emotional_availability,
                p.selected_tags,
                p.personality_data,
                p.occupation,
                p.industry,
                p.education_level,
                bp.interests,
                bp.hobbies,
                bp.ethnicity,
                bp.activity_level,
                bp.total_interactions,
                bp.successful_matches
            FROM "User" u
            JOIN "Profile" p ON u.id = p."userId"
            LEFT JOIN "BotProfile" bp ON p.id = bp."profileId"
            WHERE
                (u.is_bot = true OR u.bot_type IS NOT NULL)
                AND p.profile_status = 'APPROVED'
            ORDER BY u."createdAt" DESC
            LIMIT %s;
        """
        self.cursor.execute(query, (limit,))
        rows = self.cursor.fetchall()
        records = []
        for row in rows:
            interests = row.get("interests") or []
            hobbies = row.get("hobbies") or []
            if isinstance(interests, str):
                interests = json.loads(interests)
            if isinstance(hobbies, str):
                hobbies = json.loads(hobbies)
            records.append(
                UserProfileRecord(
                    user_id=row["user_id"],
                    bot_id=None,
                    age=row["age"] or 25,
                    gender=row["gender"] or "MALE",
                    sexuality=row.get("sexuality"),
                    city=row.get("city"),
                    relationship_goal=row.get("relationship_goal") or "DATING",
                    attachment_style=row.get("attachment_style"),
                    communication_style=row.get("communication_style"),
                    conflict_resolution=row.get("conflict_resolution"),
                    love_language=row.get("love_language"),
                    emotional_availability=row.get("emotional_availability"),
                    interests=interests,
                    hobbies=hobbies,
                    personality_data=(
                        json.loads(row["personality_data"])
                        if row.get("personality_data")
                        else None
                    ),
                    occupation=row.get("occupation"),
                    industry=row.get("industry"),
                    education_level=row.get("education_level"),
                    ethnicity=row.get("ethnicity"),
                    activity_level=row.get("activity_level"),
                    is_bot=row["is_bot"] or False,
                    bot_type=row.get("bot_type"),
                    total_interactions=row.get("total_interactions") or 0,
                    successful_matches=row.get("successful_matches") or 0,
                )
            )
        return records

    def fetch_interaction_logs(self, limit: int = 10000) -> list[dict]:
        """提取 Bot 交互日志"""
        query = """
            SELECT
                bil.id,
                bil."botUserId" as bot_id,
                bil."targetUserId" as user_id,
                bil."interactionType" as interaction_type,
                bil.action,
                bil.outcome,
                bil."engagementScore" as engagement_score,
                bil."responseDelay" as response_delay,
                bil.context
            FROM "BotInteractionLog" bil
            ORDER BY bil."createdAt" DESC
            LIMIT %s;
        """
        self.cursor.execute(query, (limit,))
        rows = self.cursor.fetchall()
        results = []
        for row in rows:
            context = None
            if row.get("context"):
                try:
                    context = json.loads(row["context"])
                except:
                    pass
            results.append(
                {
                    "bot_id": row["bot_id"],
                    "user_id": row.get("user_id"),
                    "interaction_type": row.get("interaction_type"),
                    "action": row.get("action"),
                    "outcome": row.get("outcome"),
                    "engagement_score": row.get("engagement_score") or 50,
                    "response_delay": row.get("response_delay") or 30,
                    "match_score": context.get("matchScore") if context else 50,
                }
            )
        return results


class FeatureEngine:
    """将数据库记录转换为模型输入特征"""

    FEATURE_DIM = 44  # age(1) + gender(3) + sexuality(5) + goal(4) + attach(4) + comm(4) + conflict(5) + love(5) + emotion(4) + interests(5) + activity(1) + city(3)

    @classmethod
    def profile_to_features(cls, record: UserProfileRecord) -> np.ndarray:
        """将 UserProfileRecord 或 dict 转换为 47 维特征向量"""
        # 兼容 dict 和 UserProfileRecord
        if isinstance(record, dict):
            rec = record
        else:
            rec = record
        
        def get_attr(key, default=None):
            return rec.get(key, default) if isinstance(rec, dict) else getattr(rec, key, default)
        
        features = []

        # 1. 年龄 (1维, normalized 0-1)
        age = get_attr("age", 25)
        age_norm = float(np.clip((age - 18) / 42.0, 0, 1))
        features.append(age_norm)

        # 2. 性别 (2维)
        features.extend(GENDER_ONEHOT.get(get_attr("gender", "OTHER"), [0, 0, 1]))

        # 3. 性取向 (5维)
        features.extend(SEXUALITY_ONEHOT.get(get_attr("sexuality", "OTHER"), [0, 0, 0, 0, 0]))

        # 4. 关系目标 (4维)
        features.extend(RELATIONSHIP_GOALS.get(get_attr("relationship_goal", "UNSPECIFIED"), [0, 0, 0, 1]))

        # 5. 依恋风格 (4维)
        features.extend(ATTACHMENT_STYLES.get(get_attr("attachment_style", "OTHER"), [0, 0, 0, 0]))

        # 6. 沟通风格 (4维)
        features.extend(COMMUNICATION_STYLES.get(get_attr("communication_style", "OTHER"), [0, 0, 0, 0]))

        # 7. 冲突解决 (5维)
        features.extend(CONFLICT_RESOLUTION_STYLES.get(get_attr("conflict_resolution", "OTHER"), [0, 0, 0, 0, 0]))

        # 8. 爱的语言 (5维)
        features.extend(LOVE_LANGUAGES.get(get_attr("love_language", "OTHER"), [0, 0, 0, 0, 0]))

        # 9. 情感可用性 (4维)
        features.extend(EMOTIONAL_AVAILABILITY.get(get_attr("emotional_availability", "OTHER"), [0, 0, 0, 0]))

        # 10. 兴趣特征 (5维)
        features.extend(extract_interest_features(get_attr("interests"), get_attr("hobbies")))

        # 11. 活跃度 (1维)
        activity_map = {"GHOST": 0.0, "LOW": 0.2, "MEDIUM": 0.5, "HIGH": 0.8, "FULL": 1.0}
        features.append(float(activity_map.get(get_attr("activity_level", "MEDIUM"), 0.3)))

        # 12. 城市类型 (3维)
        features.extend(city_type(get_attr("city", "TIER_2")))

        assert len(features) == cls.FEATURE_DIM, f"Feature dim mismatch: {len(features)} vs {cls.FEATURE_DIM}"
        return np.array(features, dtype=np.float32)

    @classmethod
    def profile_to_basic_attributes(cls, record: UserProfileRecord) -> np.ndarray:
        """基础属性 (9维) — 用于 MatchOutcomePredictor"""
        # 兼容 dict 和 UserProfileRecord
        if isinstance(record, dict):
            rec = record
        else:
            rec = record
        
        def get_attr(key, default=None):
            return rec.get(key, default) if isinstance(rec, dict) else getattr(rec, key, default)
        
        attrs = []

        age = get_attr("age", 25)
        age_norm = float(np.clip((age - 18) / 42.0, 0, 1))
        attrs.append(age_norm)

        attrs.extend(GENDER_ONEHOT.get(get_attr("gender", "OTHER"), [0, 0, 1]))

        activity_map = {"GHOST": 0.0, "LOW": 0.2, "MEDIUM": 0.5, "HIGH": 0.8, "FULL": 1.0}
        attrs.append(float(activity_map.get(get_attr("activity_level", "MEDIUM"), 0.3)))

        total = get_attr("total_interactions", 1) or 1
        exp_norm = float(np.clip(np.log(total + 1) / np.log(101), 0, 1))
        attrs.append(exp_norm)

        success_matches = get_attr("successful_matches", 0)
        success_rate = float(success_matches / total if total > 0 else 0.5)
        attrs.append(success_rate)

        goal_map = {"LONG_TERM": 1.0, "DATING": 0.6, "FRIENDSHIP": 0.3, "NOT_SURE": 0.1}
        attrs.append(float(goal_map.get(get_attr("relationship_goal", "NOT_SURE"), 0.5)))

        city_t = city_type(get_attr("city", "TIER_2"))
        attrs.append(float(sum(city_t)))

        assert len(attrs) == 9, f"Attribute dim mismatch: {len(attrs)}"
        return np.array(attrs, dtype=np.float32)

    @classmethod
    def profiles_to_batch(cls, records: list[UserProfileRecord]) -> tuple[np.ndarray, np.ndarray, list[str]]:
        """将记录列表转换为批次数据"""
        features = []
        attributes = []
        ids = []
        for record in records:
            features.append(cls.profile_to_features(record))
            attributes.append(cls.profile_to_basic_attributes(record))
            # 兼容 dict 和 UserProfileRecord
            user_id = record.get("user_id") if isinstance(record, dict) else getattr(record, "user_id", "unknown")
            ids.append(user_id)
        return np.stack(features), np.stack(attributes), ids


class MatchOutcomeEncoder:
    """将匹配结果编码为训练标签"""

    @classmethod
    def encode_match_outcome(
        cls,
        interaction_type: str,
        action: str,
        outcome: str,
        engagement_score: float,
    ) -> tuple[float, np.ndarray]:
        """返回: (match_label, compatibility_scores)"""
        success_outcomes = {"success", "accepted", "interested", "matched"}
        fail_outcomes = {"rejected", "blocked", "no_response", "expired"}
        neutral_outcomes = {"pending", "maybe"}

        if outcome in success_outcomes:
            match_label = 1.0
        elif outcome in fail_outcomes:
            match_label = 0.0
        else:
            match_label = 0.5

        engagement = engagement_score / 100.0
        base = 50 + (engagement - 0.5) * 40
        noise = np.random.randn(5) * 5
        compat = np.clip(base + noise, 0, 100)

        if action == "accept":
            compat += 10
        elif action == "pass":
            compat -= 10
        elif action == "block":
            compat -= 20

        compat = np.clip(compat, 0, 100)
        return float(match_label), compat.astype(np.float32)
