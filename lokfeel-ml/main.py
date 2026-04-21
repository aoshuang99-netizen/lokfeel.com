#!/usr/bin/env python3
"""
LokFeel ML — Tinygrad Neural Network System
命令行入口

用法:
  python main.py extract                    # 从数据库提取种子用户
  python main.py train                      # 完整训练流程
  python main.py infer --bot-id xxx         # 推理测试
  python main.py serve                      # 启动推理服务 (FastAPI)
  python main.py demo                       # Demo 模式 (无需数据库)
"""

import os
import sys
import json
import argparse
import numpy as np
from pathlib import Path

# 添加包路径
sys.path.insert(0, str(Path(__file__).parent))

from lokfeel_ml.data import DataExtractor, FeatureEngine
from lokfeel_ml.training import Trainer
from lokfeel_ml.inference import LokFeelInference


# ============================================================
# Demo 数据 (无需数据库连接)
# ============================================================

DEMO_PROFILES = [
    {
        "user_id": "demo_001",
        "age": 28,
        "gender": "MALE",
        "sexuality": "Straight",
        "city": "New York",
        "relationship_goal": "LONG_TERM",
        "attachment_style": "Secure",
        "communication_style": "Direct",
        "conflict_resolution": "Collaborative",
        "love_language": "Quality Time",
        "emotional_availability": "Fully Available",
        "interests": ["hiking", "cooking", "photography"],
        "hobbies": ["reading", "gaming"],
        "activity_level": "MEDIUM",
        "is_bot": True,
        "bot_type": "SEED",
        "total_interactions": 45,
        "successful_matches": 12,
    },
    {
        "user_id": "demo_002",
        "age": 26,
        "gender": "FEMALE",
        "sexuality": "Straight",
        "city": "Los Angeles",
        "relationship_goal": "DATING",
        "attachment_style": "Anxious-Preoccupied",
        "communication_style": "Expressive",
        "conflict_resolution": "Accommodating",
        "love_language": "Words of Affirmation",
        "emotional_availability": "Building Trust",
        "interests": ["yoga", "traveling", "music"],
        "hobbies": ["painting"],
        "activity_level": "HIGH",
        "is_bot": True,
        "bot_type": "SEED",
        "total_interactions": 38,
        "successful_matches": 8,
    },
    {
        "user_id": "demo_003",
        "age": 31,
        "gender": "MALE",
        "sexuality": "Bisexual",
        "city": "San Francisco",
        "relationship_goal": "LONG_TERM",
        "attachment_style": "Dismissive-Avoidant",
        "communication_style": "Analytical",
        "conflict_resolution": "Competing",
        "love_language": "Acts of Service",
        "emotional_availability": "Needs Space",
        "interests": ["tech", "science", "reading"],
        "hobbies": ["hiking", "photography"],
        "activity_level": "LOW",
        "is_bot": True,
        "bot_type": "SIMULATION",
        "total_interactions": 22,
        "successful_matches": 5,
    },
]


def demo_mode(args):
    """Demo 模式: 不需要数据库,使用内置示例数据"""
    print("=" * 60)
    print("LokFeel ML — Demo Mode (无需数据库)")
    print("=" * 60)

    # 使用内置示例数据
    from lokfeel_ml.data import UserProfileRecord

    records = []
    for p in DEMO_PROFILES:
        records.append(
            UserProfileRecord(
                user_id=p["user_id"],
                bot_id=None,
                age=p["age"],
                gender=p["gender"],
                sexuality=p.get("sexuality"),
                city=p.get("city"),
                relationship_goal=p.get("relationship_goal", "DATING"),
                attachment_style=p.get("attachment_style"),
                communication_style=p.get("communication_style"),
                conflict_resolution=p.get("conflict_resolution"),
                love_language=p.get("love_language"),
                emotional_availability=p.get("emotional_availability"),
                interests=p.get("interests", []),
                hobbies=p.get("hobbies", []),
                personality_data=None,
                occupation=p.get("occupation"),
                industry=p.get("industry"),
                education_level=p.get("education_level"),
                ethnicity=p.get("ethnicity"),
                activity_level=p.get("activity_level"),
                is_bot=p.get("is_bot", False),
                bot_type=p.get("bot_type"),
                total_interactions=p.get("total_interactions", 0),
                successful_matches=p.get("successful_matches", 0),
            )
        )

    # 特征工程
    features, attrs, ids = FeatureEngine.profiles_to_batch(records)
    print(f"\n[Data] Extracted {len(records)} profiles")
    print(f"[Data] Feature shape: {features.shape}")
    print(f"[Data] Attribute shape: {attrs.shape}")
    print(f"[Data] Feature sample (first 10 dims): {features[0][:10]}")

    # 训练
    trainer = Trainer(embedding_dim=64, lr=0.01, batch_size=8, epochs=10)

    match_pairs = []
    for i in range(len(records)):
        for j in range(i + 1, len(records)):
            if np.random.rand() > 0.3:
                match_pairs.append((i, j))

    interaction_logs = [
        {
            "bot_id": records[i % len(records)].user_id,
            "user_id": records[(i + 1) % len(records)].user_id,
            "interaction_type": "chat_message",
            "action": np.random.choice(["accept", "pass", "respond"]),
            "outcome": np.random.choice(["success", "rejected", "no_response"]),
            "engagement_score": np.random.randint(30, 90),
            "response_delay": np.random.randint(10, 120),
            "match_score": np.random.randint(40, 90),
        }
        for i in range(200)
    ]

    results = trainer.full_training_pipeline(
        features=features,
        match_pairs=match_pairs,
        interaction_logs=interaction_logs,
        save_dir=args.save if args.save else "./models/demo",
    )

    print(f"\n[Result] Training completed:")
    print(json.dumps(results, indent=2, default=str))

    # 推理测试
    print("\n" + "=" * 60)
    print("Inference Test")
    print("=" * 60)

    inference = LokFeelInference(load_dir=args.save if args.save else "./models/demo")
    inference.load(args.save if args.save else "./models/demo")

    for i in range(len(DEMO_PROFILES)):
        for j in range(i + 1, len(DEMO_PROFILES)):
            score = inference.predict_match(DEMO_PROFILES[i], DEMO_PROFILES[j])
            print(f"\n[Match] {DEMO_PROFILES[i]['user_id']} vs {DEMO_PROFILES[j]['user_id']}:")
            print(f"  Probability: {score.match_probability}")
            print(f"  Recommendation: {score.recommendation}")
            print(f"  Compatibility: {score.compatibility_scores}")

    # 行为生成测试
    print("\n[Behavior Generation]")
    behavior = inference.generate_bot_behavior(DEMO_PROFILES[0], DEMO_PROFILES[1])
    print(f"  Response delay: {behavior.response_delay_minutes:.1f} min")
    print(f"  Message length: {behavior.message_length_range} chars")
    print(f"  Emoji prob: {behavior.emoji_probability}")
    print(f"  Style: {behavior.recommended_style}")
    print(f"  Topics: {behavior.topic_preferences}")

    # 策略选择测试
    print("\n[Strategy Selection]")
    for bot_id in [r.user_id for r in records[:3]]:
        strategy = inference.select_bot_strategy(bot_id, method="ucb1")
        print(f"  Bot {bot_id}: {strategy['strategy_id']} ({strategy['description']})")

    print("\n" + "=" * 60)
    print("Demo Complete!")
    print("=" * 60)


def extract_data(args):
    """从数据库提取种子用户数据"""
    print("[Extract] Connecting to database...")
    extractor = DataExtractor()

    try:
        extractor.connect()
        records = extractor.fetch_seed_users(limit=args.limit or 3500)
        print(f"[Extract] Fetched {len(records)} seed users")

        features, attrs, ids = FeatureEngine.profiles_to_batch(records)

        out_dir = Path(args.output or "./data")
        out_dir.mkdir(parents=True, exist_ok=True)

        np.save(out_dir / "features.npy", features)
        np.save(out_dir / "attributes.npy", attrs)
        with open(out_dir / "user_ids.json", "w") as f:
            json.dump(ids, f)

        print(f"[Extract] Saved to {out_dir}")
        print(f"  features.npy: {features.shape}")
        print(f"  attributes.npy: {attrs.shape}")

        # 提取交互日志
        logs = extractor.fetch_interaction_logs(limit=10000)
        print(f"[Extract] Fetched {len(logs)} interaction logs")
        with open(out_dir / "interaction_logs.json", "w") as f:
            json.dump(logs, f, default=str)

        return records, logs

    finally:
        extractor.close()


def train(args):
    """完整训练流程"""
    data_dir = Path(args.data or "./data")
    save_dir = Path(args.save or "./models")

    # 加载数据
    if args.use_db:
        records, logs = extract_data(args)
        features, _, ids = FeatureEngine.profiles_to_batch(records)
    elif (data_dir / "features.npy").exists():
        features = np.load(data_dir / "features.npy")
        with open(data_dir / "user_ids.json") as f:
            ids = json.load(f)
        with open(data_dir / "interaction_logs.json") as f:
            logs = json.load(f)
        print(f"[Train] Loaded data from {data_dir}")
    else:
        print("[Train] No data found. Run with --db flag or ensure data exists.")
        sys.exit(1)

    # 构造匹配对
    match_pairs = []
    n = min(len(ids), 5000)
    for i in range(n):
        for j in range(i + 1, n):
            match_pairs.append((i, j))
            if len(match_pairs) >= 5000:
                break
        if len(match_pairs) >= 5000:
            break

    print(f"[Train] Total match pairs: {len(match_pairs)}")

    # 训练
    trainer = Trainer(
        embedding_dim=args.embedding_dim or 64,
        lr=args.lr or 0.001,
        batch_size=args.batch_size or 64,
        epochs=args.epochs or 20,
    )

    results = trainer.full_training_pipeline(
        features=features,
        match_pairs=match_pairs,
        interaction_logs=logs,
        save_dir=str(save_dir),
    )

    print("\n[Result]")
    print(json.dumps(results, indent=2, default=str))


def infer(args):
    """推理测试"""
    inference = LokFeelInference()

    if args.save:
        inference.load(args.save)

    if args.bot_id:
        strategy = inference.select_bot_strategy(args.bot_id)
        print(json.dumps(strategy, indent=2))
    else:
        for profile in DEMO_PROFILES[:2]:
            behavior = inference.generate_bot_behavior(profile)
            print(f"Bot {profile['user_id']}:")
            print(f"  Style: {behavior.recommended_style}")
            print(f"  Response delay: {behavior.response_delay_minutes:.1f} min")


def serve(args):
    """启动 FastAPI 推理服务"""
    try:
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware
        import uvicorn
    except ImportError:
        print("FastAPI not installed. Run: pip install fastapi uvicorn")
        sys.exit(1)

    app = FastAPI(title="LokFeel ML Inference API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    inference = LokFeelInference(load_dir=args.save or "./models")

    @app.get("/health")
    def health():
        return {"status": "ok", "model": "lokfeel-ml-v1"}

    @app.post("/predict-match")
    def predict_match(user_a: dict, user_b: dict):
        result = inference.predict_match(user_a, user_b)
        return {
            "match_probability": result.match_probability,
            "compatibility_scores": result.compatibility_scores,
            "recommendation": result.recommendation,
            "reasons": result.reasons,
        }

    @app.post("/generate-behavior")
    def generate_behavior(bot_profile: dict, target_profile: dict | None = None):
        result = inference.generate_bot_behavior(bot_profile, target_profile)
        return {
            "response_delay_minutes": result.response_delay_minutes,
            "message_length_range": result.message_length_range,
            "emoji_probability": result.emoji_probability,
            "question_frequency": result.question_frequency,
            "initiative_level": result.initiative_level,
            "recommended_style": result.recommended_style,
            "topic_preferences": result.topic_preferences,
        }

    @app.post("/select-strategy")
    def select_strategy(bot_id: str, method: str = "ucb1"):
        return inference.select_bot_strategy(bot_id, method)

    @app.post("/record-feedback")
    def record_feedback(feedback: dict):
        return inference.record_and_evolve(feedback)

    @app.get("/evolution-report")
    def evolution_report():
        return inference.get_evolution_report()

    print(f"[Serve] Starting inference API on :{args.port or 8000}")
    uvicorn.run(app, host="0.0.0.0", port=args.port or 8000)


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="LokFeel ML — Tinygrad Neural Network")
    sub = parser.add_subparsers(dest="command")

    # Demo
    demo_p = sub.add_parser("demo", help="Demo mode (no DB required)")
    demo_p.add_argument("--save", default="./models/demo", help="Save directory")

    # Extract
    extract_p = sub.add_parser("extract", help="Extract data from database")
    extract_p.add_argument("--limit", type=int, default=3500, help="Max users to extract")
    extract_p.add_argument("--output", default="./data", help="Output directory")

    # Train
    train_p = sub.add_parser("train", help="Run training pipeline")
    train_p.add_argument("--data", help="Data directory (skip DB)")
    train_p.add_argument("--save", default="./models", help="Model save directory")
    train_p.add_argument("--use-db", action="store_true", help="Fetch from DB")
    train_p.add_argument("--embedding-dim", type=int, default=64)
    train_p.add_argument("--lr", type=float, default=0.001)
    train_p.add_argument("--batch-size", type=int, default=64)
    train_p.add_argument("--epochs", type=int, default=20)

    # Infer
    infer_p = sub.add_parser("infer", help="Run inference")
    infer_p.add_argument("--save", help="Model directory")
    infer_p.add_argument("--bot-id", help="Bot ID")

    # Serve
    serve_p = sub.add_parser("serve", help="Start inference API server")
    serve_p.add_argument("--save", default="./models", help="Model directory")
    serve_p.add_argument("--port", type=int, default=8000, help="Port")

    args = parser.parse_args()

    if args.command == "demo":
        demo_mode(args)
    elif args.command == "extract":
        extract_data(args)
    elif args.command == "train":
        train(args)
    elif args.command == "infer":
        infer(args)
    elif args.command == "serve":
        serve(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
