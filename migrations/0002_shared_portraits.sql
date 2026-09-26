CREATE TABLE IF NOT EXISTS shared_portraits (
  id VARCHAR(48) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title TEXT,
  study_id TEXT,
  image_data TEXT,
  particle_data TEXT,
  params JSONB NOT NULL,
  yaw REAL NOT NULL DEFAULT 0,
  pitch REAL NOT NULL DEFAULT 0.04,
  zoom REAL NOT NULL DEFAULT 1.0
);
