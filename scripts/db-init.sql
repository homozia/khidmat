-- Runs once when the container's data volume is created.
CREATE DATABASE khidmat_test OWNER khidmat;
\c khidmat_dev
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
\c khidmat_test
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
