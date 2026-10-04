-- psql reads secret environment variables without shell execution or SQL literals.
\getenv reader_password REPORTING_READER_PASSWORD
\getenv writer_password REPORTING_WRITER_PASSWORD
REVOKE CONNECT, TEMPORARY ON DATABASE metabase FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE reporting_reader LOGIN PASSWORD :'reader_password';
CREATE ROLE reporting_writer LOGIN PASSWORD :'writer_password';
CREATE DATABASE mizyun_reporting;
REVOKE ALL ON DATABASE mizyun_reporting FROM PUBLIC;
GRANT CONNECT ON DATABASE mizyun_reporting TO reporting_reader, reporting_writer;
GRANT TEMPORARY ON DATABASE mizyun_reporting TO reporting_writer;
\connect mizyun_reporting
\include /opt/analytics/warehouse.sql
