-- 001_initial.sql
-- Initial schema for the NFT marketplace search module.
-- This file is the source of truth for the nfts table because Prisma cannot
-- express GENERATED ALWAYS AS STORED tsvector columns.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS nfts (
  id               BIGSERIAL PRIMARY KEY,
  token_id         TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  creator_address  TEXT NOT NULL,
  owner_address    TEXT NOT NULL,
  collection_name  TEXT NOT NULL,
  traits           JSONB DEFAULT '{}'::jsonb,
  price_eth        NUMERIC(20, 8),
  is_listed        BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),

  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(collection_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('simple',  coalesce(creator_address, '')), 'D') ||
    setweight(to_tsvector('simple',  coalesce(owner_address, '')), 'D')
  ) STORED,

  CONSTRAINT nfts_contract_token_unique UNIQUE (contract_address, token_id)
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_nfts_updated_at ON nfts;
CREATE TRIGGER trg_nfts_updated_at
  BEFORE UPDATE ON nfts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes. CONCURRENTLY = zero downtime on live tables.
-- NOTE: CONCURRENTLY cannot run inside a transaction. The docker-entrypoint
-- initdb wrapper executes each statement individually, so this is fine here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nfts_search_vector
  ON nfts USING GIN(search_vector);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nfts_traits
  ON nfts USING GIN(traits);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nfts_collection
  ON nfts(collection_name);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nfts_listed_price
  ON nfts(is_listed, price_eth) WHERE is_listed = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nfts_name_trgm
  ON nfts USING GIN(name gin_trgm_ops);
