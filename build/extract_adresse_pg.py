import os
import duckdb

QUERY = """
SELECT b.idmutation, a.*
FROM pgdb.dvf_plus_2026_2.dvf_plus_adresse AS a
LEFT JOIN pgdb.dvf_plus_2026_2.dvf_plus_adresse_local AS b
  ON a.idadresse = b.idadresse
"""

OUTPUT = "adresse.parquet"


def q(value):
    """Quote a value as a SQL string literal, escaping single quotes."""
    return "'" + str(value).replace("'", "''") + "'"


def main():
    host = os.environ.get("DB_HOST")
    port = os.environ.get("DB_PORT")
    dbname = os.environ.get("DB_NAME")
    user = os.environ.get("DB_USER")
    password = os.environ.get("DB_PASSWORD")

    con = duckdb.connect()
    try:
        try:
            con.execute("LOAD postgres;")
        except Exception:
            con.execute("INSTALL postgres;")
            con.execute("LOAD postgres;")
        con.execute(
            "CREATE SECRET pg_secret ("
            f"TYPE postgres, "
            f"HOST {q(host)}, "
            f"PORT {int(port)}, "
            f"DATABASE {q(dbname)}, "
            f"USER {q(user)}, "
            f"PASSWORD {q(password)}"
            ");"
        )
        con.execute("ATTACH '' AS pgdb (TYPE postgres, SECRET pg_secret);")
        con.execute(f"COPY ({QUERY}) TO {q(OUTPUT)} (FORMAT PARQUET);")

        rows = con.execute(f"SELECT count(*) FROM {q(OUTPUT)}").fetchone()[0]
        cols = con.execute(
            "SELECT count(*) FROM (DESCRIBE SELECT * FROM " + q(OUTPUT) + ")"
        ).fetchone()[0]
    finally:
        con.close()

    print(f"Wrote {rows} rows x {cols} cols to {OUTPUT}")


if __name__ == "__main__":
    main()
