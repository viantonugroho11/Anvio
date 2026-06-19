# Memory Architecture

## Short-Term (Redis)

Active context, session state, TTL-based.

## Long-Term (PostgreSQL)

User preferences, facts, historical information.

## Semantic (Qdrant, Phase 2)

Embeddings, knowledge retrieval.

## Policies

- Memory ranking by recency and relevance
- Summarization when token budget exceeded
- Retention policies per memory type
