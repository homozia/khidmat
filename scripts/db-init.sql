-- Runs once when the container's data volume is created.
CREATE DATABASE khidmat_test OWNER khidmat;
\c khidmat_dev
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
\c khidmat_test
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Two extra test databases: the customer app's tests run two API servers side by side (npm test -w apps/mobile).
\c postgres
CREATE DATABASE khidmat_a_test OWNER khidmat;
CREATE DATABASE khidmat_b_test OWNER khidmat;
\c khidmat_a_test
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
\c khidmat_b_test
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
