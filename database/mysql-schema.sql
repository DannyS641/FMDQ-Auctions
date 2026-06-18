-- =============================================================================
-- FMDQ Auctions — MySQL schema (WAMP migration, Phase 1)
-- Target: MySQL 8.0.16+  (enforced CHECK, JSON, DESC indexes, expression defaults)
-- Engine: InnoDB   Charset: utf8mb4   Collation: utf8mb4_0900_ai_ci
--
-- Generated from docs/SCHEMA_MAPPING.md. Postgres-specific features removed:
--   * pgcrypto extension            -> IDs generated in PHP (ramsey/uuid), 36-char
--   * RLS "no direct client" policies -> N/A: only the PHP API connects to MySQL
--   * place_auction_bid() RPC        -> reimplemented as a PHP transaction (Phase 3)
--   * set_updated_at() trigger fn    -> dropped (was never attached to a table)
--   * notify pgrst                   -> dropped (PostgREST cache reload)
--
-- All timestamps are stored in UTC. The PHP layer reads/writes UTC explicitly.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS fmdq_auctions
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE fmdq_auctions;

-- -----------------------------------------------------------------------------
-- schema_migrations  (was: text PK + deny-all RLS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(255) NOT NULL,
  applied_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- roles  (lookup table; PK is the role name)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  name        VARCHAR(64) NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- categories  (lookup table; PK is the category name)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  name        VARCHAR(128) NOT NULL,
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- users  (local/external accounts; internal AD users authenticate via LDAP)
--   status enum was: text + CHECK (pending_verification|active|disabled)
-- -----------------------------------------------------------------------------
-- NOTE: auth_source / nullable password_hash added in Phase 2 (hybrid auth).
--   * 'local' = external account, password_hash set, verified with password_verify()
--   * 'ad'    = internal account provisioned on first LDAP login, password_hash NULL
CREATE TABLE IF NOT EXISTS users (
  id             CHAR(36)     NOT NULL,
  email          VARCHAR(255) NOT NULL,
  password_hash  VARCHAR(255) NULL,
  display_name   VARCHAR(255) NOT NULL,
  status         ENUM('pending_verification','active','disabled')
                              NOT NULL DEFAULT 'active',
  auth_source    ENUM('local','ad') NOT NULL DEFAULT 'local',
  created_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_login_at  DATETIME(6)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- items  (numeric(18,2) -> DECIMAL(18,2); timestamptz -> DATETIME(6) UTC)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  id                CHAR(36)      NOT NULL,
  title             VARCHAR(255)  NOT NULL,
  category          VARCHAR(128)  NOT NULL,
  lot               VARCHAR(128)  NOT NULL,
  sku               VARCHAR(128)  NOT NULL,
  `condition`       VARCHAR(64)   NOT NULL,
  location          VARCHAR(255)  NOT NULL,
  start_bid         DECIMAL(18,2) NOT NULL,
  reserve           DECIMAL(18,2) NOT NULL DEFAULT 0,
  increment_amount  DECIMAL(18,2) NOT NULL,
  current_bid       DECIMAL(18,2) NOT NULL DEFAULT 0,
  start_time        DATETIME(6)   NOT NULL,
  end_time          DATETIME(6)   NOT NULL,
  description       TEXT          NOT NULL DEFAULT (''),
  created_at        DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  archived_at       DATETIME(6)   NULL,
  PRIMARY KEY (id),
  CONSTRAINT items_end_after_start   CHECK (end_time > start_time),
  CONSTRAINT items_start_bid_positive CHECK (start_bid > 0),
  CONSTRAINT items_reserve_non_negative CHECK (reserve >= 0),
  CONSTRAINT items_increment_positive CHECK (increment_amount > 0),
  KEY idx_items_created_at (created_at DESC),
  KEY idx_items_archived_at (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- item_files  (kind enum was: text + CHECK (image|document))
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_files (
  id       CHAR(36)               NOT NULL,
  item_id  CHAR(36)               NOT NULL,
  kind     ENUM('image','document') NOT NULL,
  name     VARCHAR(255)           NOT NULL,
  url      VARCHAR(1024)          NOT NULL,
  PRIMARY KEY (id),
  KEY idx_item_files_item_kind (item_id, kind),
  CONSTRAINT fk_item_files_item
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- bids  (bidder_user_id added in PG migration 0001; ON DELETE SET NULL)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bids (
  id              CHAR(36)      NOT NULL,
  item_id         CHAR(36)      NOT NULL,
  bidder_alias    VARCHAR(64)   NOT NULL,
  amount          DECIMAL(18,2) NOT NULL,
  bid_time        VARCHAR(8)    NOT NULL,   -- display 'HH:MM' string, not a real time
  created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  bidder_user_id  CHAR(36)      NULL,
  PRIMARY KEY (id),
  CONSTRAINT bids_amount_positive CHECK (amount > 0),
  KEY idx_bids_item_created_at (item_id, created_at DESC),
  KEY idx_bids_item_amount_created_at (item_id, amount DESC, created_at DESC),
  CONSTRAINT fk_bids_item
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_bids_user
    FOREIGN KEY (bidder_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- bid_idempotency_keys  (was: deny-all RLS; client-supplied key is the PK)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bid_idempotency_keys (
  idempotency_key  VARCHAR(255)  NOT NULL,
  item_id          CHAR(36)      NOT NULL,
  bid_id           CHAR(36)      NOT NULL,
  bidder_user_id   CHAR(36)      NULL,
  amount           DECIMAL(18,2) NOT NULL,
  bid_sequence     INT           NOT NULL,
  created_at       DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at       DATETIME(6)   NOT NULL,
  PRIMARY KEY (idempotency_key),
  KEY idx_bid_idempotency_keys_expires_at (expires_at),
  CONSTRAINT fk_bid_idem_item
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_bid_idem_bid
    FOREIGN KEY (bid_id) REFERENCES bids(id) ON DELETE CASCADE,
  CONSTRAINT fk_bid_idem_user
    FOREIGN KEY (bidder_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- user_roles  (composite PK; join between users and roles)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
  user_id     CHAR(36)    NOT NULL,
  role_name   VARCHAR(64) NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, role_name),
  KEY idx_user_roles_role (role_name),
  CONSTRAINT fk_user_roles_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role
    FOREIGN KEY (role_name) REFERENCES roles(name) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- sessions  (app-issued sessions; the new JWT/session layer also lives here)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          CHAR(36)    NOT NULL,
  user_id     CHAR(36)    NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at  DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sessions_expires_at (expires_at),
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- email_verification_tokens
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          CHAR(36)     NOT NULL,
  user_id     CHAR(36)     NOT NULL,
  token       VARCHAR(255) NOT NULL,
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at  DATETIME(6)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_verification_token (token),
  KEY idx_email_verification_expires_at (expires_at),
  CONSTRAINT fk_email_verification_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- audits  (jsonb -> JSON; default '{}' -> JSON_OBJECT())
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audits (
  id            CHAR(36)     NOT NULL,
  event_type    VARCHAR(64)  NOT NULL,
  entity_type   VARCHAR(64)  NOT NULL,
  entity_id     VARCHAR(255) NOT NULL,
  actor         VARCHAR(255) NOT NULL,
  actor_type    VARCHAR(64)  NOT NULL,
  request_id    VARCHAR(255) NOT NULL,
  details_json  JSON         NOT NULL DEFAULT (JSON_OBJECT()),
  created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_audits_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- notification_queue  (channel/status enums; claim columns from PG migrations 0001/0003)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_queue (
  id                CHAR(36)      NOT NULL,
  channel           ENUM('email') NOT NULL,
  event_type        VARCHAR(64)   NOT NULL,
  recipient         VARCHAR(255)  NOT NULL,
  subject           VARCHAR(512)  NOT NULL,
  status            ENUM('pending','sent','failed') NOT NULL,
  payload_json      JSON          NOT NULL DEFAULT (JSON_OBJECT()),
  created_at        DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  processed_at      DATETIME(6)   NULL,
  next_attempt_at   DATETIME(6)   NULL,
  attempt_count     INT           NOT NULL DEFAULT 0,
  claim_token       VARCHAR(255)  NULL,
  claim_expires_at  DATETIME(6)   NULL,
  error_message     TEXT          NULL,
  PRIMARY KEY (id),
  KEY idx_notification_queue_status_created_at (status, created_at DESC),
  KEY idx_notification_queue_claim_ready (status, next_attempt_at, claim_expires_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- security_events  (was: deny-all RLS; jsonb -> JSON)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_events (
  id            CHAR(36)     NOT NULL,
  event_type    VARCHAR(64)  NOT NULL,
  actor         VARCHAR(255) NOT NULL,
  request_id    VARCHAR(255) NOT NULL,
  details_json  JSON         NOT NULL DEFAULT (JSON_OBJECT()),
  created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_security_events_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- Seed data
-- =============================================================================
-- NOTE: classic `ON DUPLICATE KEY UPDATE col = col` no-op keeps these inserts
-- idempotent without the row-alias syntax (which needs MySQL 8.0.19+).
INSERT INTO roles (name) VALUES
  ('Admin'), ('Bidder'), ('Observer')
  ON DUPLICATE KEY UPDATE name = name;

INSERT INTO categories (name) VALUES
  ('Cars'), ('Furniture'), ('Household Appliances'),
  ('Kitchen Appliances'), ('Phones'), ('Other')
  ON DUPLICATE KEY UPDATE name = name;

-- Baseline marker for the NEW MySQL stack's migration tracking.
-- (The old Postgres migration names 0001..0003 are already folded into this
--  consolidated schema, so they are not replayed here.)
INSERT INTO schema_migrations (version) VALUES
  ('0001_mysql_baseline')
  ON DUPLICATE KEY UPDATE version = version;
