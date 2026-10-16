BEGIN;

CREATE ROLE job_tracker_migrator
    LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOBYPASSRLS;

GRANT CONNECT ON DATABASE job_tracker TO job_tracker_migrator;

CREATE SCHEMA tracker AUTHORIZATION job_tracker_migrator;

REVOKE ALL ON SCHEMA tracker FROM PUBLIC;

GRANT USAGE ON SCHEMA tracker TO job_tracker_app;

COMMIT;