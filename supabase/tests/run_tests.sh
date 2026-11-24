#!/usr/bin/env bash
# Prueba el esquema en un PostgreSQL temporal (no necesita Supabase ni Internet).
# Requisitos: binarios de PostgreSQL 15+ (initdb, pg_ctl, psql, pgbench).
# Uso: bash supabase/tests/run_tests.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATION="$HERE/../migrations/20260101000000_init_schema.sql"
MIGRATION2="$HERE/../migrations/20260102000000_receipts.sql"
MIGRATION3="$HERE/../migrations/20260103000000_notable_roles.sql"
PGBIN="${PGBIN:-$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | sort -V | tail -1)")}"
PORT="${PGPORT:-54999}"
DATA="$(mktemp -d)"
RUNAS=""
if [ "$(id -u)" = "0" ]; then            # PostgreSQL no arranca como root
  id postgres >/dev/null 2>&1 || useradd -m postgres
  chown -R postgres "$DATA"; chmod 700 "$DATA"
  RUNAS="su postgres -s /bin/bash -c"
fi
run() { if [ -n "$RUNAS" ]; then $RUNAS "$*"; else bash -c "$*"; fi; }
cleanup() { run "$PGBIN/pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

run "$PGBIN/initdb -D $DATA -A trust -U postgres" >/dev/null
run "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l $DATA/log -w start" >/dev/null
PSQL="$PGBIN/psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

echo "▶ Creando base de datos y simulando Supabase (roles, auth, storage, realtime)"
run "$PSQL -d postgres -c 'create database resto'" 
run "$PSQL -d resto -f $HERE/00_supabase_stubs.sql"
echo "▶ Aplicando la migración desde cero"
run "$PSQL -d resto -f $MIGRATION"
run "$PSQL -d resto -f $MIGRATION2"
run "$PSQL -d resto -f $MIGRATION3"
echo "▶ Ejecutando pruebas funcionales y de seguridad"
run "$PSQL -d resto -f $HERE/01_tests.sql" 2>&1 | sed -e 's/^psql:.*NOTICE:  //' -e 's/^NOTICE:  //' | grep -E "PASS|FAIL|===|ERROR" | tee "$HERE/last_run.log"
if grep -q "FAIL\|ERROR" "$HERE/last_run.log"; then echo "✖ HAY FALLOS"; exit 1; fi
echo "▶ Pruebas de boletas (migración 2)"
run "$PSQL -d resto -f $HERE/03_receipts_tests.sql" 2>&1 | sed -e 's/^psql:.*NOTICE:  //' -e 's/^NOTICE:  //' | grep -E "PASS|FAIL|===|ERROR" | tee "$HERE/last_run_receipts.log"
if grep -q "FAIL\|ERROR" "$HERE/last_run_receipts.log"; then echo "✖ HAY FALLOS EN BOLETAS"; exit 1; fi
echo "▶ Pruebas de pedidos sin mesa y puestos (migración 3)"
run "$PSQL -d resto -f $HERE/04_notable_roles_tests.sql" 2>&1 | sed -e 's/^psql:.*NOTICE:  //' -e 's/^NOTICE:  //' | grep -E "PASS|FAIL|===|ERROR" | tee "$HERE/last_run_notable_roles.log"
if grep -q "FAIL\|ERROR" "$HERE/last_run_notable_roles.log"; then echo "✖ HAY FALLOS EN PEDIDOS SIN MESA / PUESTOS"; exit 1; fi
echo "▶ Prueba de concurrencia (pgbench): 8 clientes, misma clave y claves distintas"
run "$PSQL -d resto -f $HERE/02_concurrency_setup.sql"
OUT=$(run "$PGBIN/pgbench -h /tmp -p $PORT -U postgres -n -c 8 -j 4 -t 25 -f $HERE/02_race_same_request.sql resto" 2>&1)
echo "$OUT" | grep -E "number of (transactions|failed)|processed"
OUT2=$(run "$PGBIN/pgbench -h /tmp -p $PORT -U postgres -n -c 8 -j 4 -t 25 -f $HERE/02_race_distinct.sql resto" 2>&1)
echo "$OUT2" | grep -E "number of (transactions|failed)|processed"
run "$PSQL -d resto -f $HERE/02_concurrency_check.sql" 2>&1 | grep -E "PASS|FAIL|ERROR"
echo "✔ TODO OK"
