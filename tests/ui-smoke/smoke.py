"""Prueba de humo de la interfaz en un Chrome real con un Supabase SIMULADO (sin Internet).
Verifica que el menú QR, el login, la caja y la cocina cargan sin errores y envían las llamadas correctas.
Uso:  npm run build && python3 tests/ui-smoke/smoke.py
"""
import json, re, subprocess, sys, time, os, signal
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = 8099
FAKE = 'http://127.0.0.1:54321'

# dist con la configuración apuntando al servidor simulado
cfg = os.path.join(ROOT, 'dist', 'config.js')
open(cfg, 'w').write(f'window.__APP_CONFIG__={{SUPABASE_URL:"{FAKE}",SUPABASE_ANON_KEY:"anon-test"}};')
srv = subprocess.Popen(['npx', 'vite', 'preview', '--port', str(PORT), '--strictPort'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, preexec_fn=os.setsid)
time.sleep(3)

SETTINGS = dict(id=1, name='Cremoso Test', currency_symbol='S/', tax_rate=0.18, prices_include_tax=True, timezone='America/Lima',
                qr_ordering_enabled=True, qr_max_pending_per_table=3, public_base_url=None, receipt_footer=None)
CATS = [dict(id='c1', name='Comidas', description=None, sort_order=1, is_active=True), dict(id='c2', name='Bebidas', description=None, sort_order=2, is_active=True)]
PRODS = [
    dict(id='p1', category_id='c1', name='Hamburguesa', description='Con queso', ingredients='Carne, pan', price=20, final_price=20, image_path=None, is_available=True, sort_order=1),
    dict(id='p2', category_id='c1', name='Pizza', description=None, ingredients=None, price=30, final_price=30, image_path=None, is_available=False, sort_order=2),
    dict(id='p3', category_id='c2', name='Gaseosa', description=None, ingredients=None, price=10, final_price=9, image_path=None, is_available=True, sort_order=1),
]
ORDER = dict(id='o1', order_number=12, table_id='t1', channel='qr', status='pending', payment_status='unpaid', customer_note='sin ají', subtotal=29, discount_total=1, tax_amount=4.42, total=29,
             created_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), preparing_at=None, ready_at=None, delivered_at=None, paid_at=None,
             tables=dict(number=5, name=None),
             order_items=[dict(id='i1', order_id='o1', product_id='p1', line_no=1, product_name='Hamburguesa', list_price=20, unit_price=20, quantity=1, notes='sin cebolla', line_total=20),
                          dict(id='i2', order_id='o1', product_id='p3', line_no=2, product_name='Gaseosa', list_price=10, unit_price=9, quantity=1, notes=None, line_total=9)])
PROFILE = dict(id='u1', email='admin@test.pe', full_name='Admin', is_active=True, role='admin', role_label='Administrador', permissions=['*'])
TABLES = [dict(id='t1', number=5, name=None, capacity=4, qr_token='abc123', is_active=True)]

PAY_ORDER = dict(ORDER, id='o2', order_number=13, status='delivered', payment_status='paid', channel='internal', customer_note=None,
                 subtotal=800, discount_total=0, tax_amount=122.03, total=800,
                 order_items=[dict(id='i9', order_id='o2', product_id='p9', line_no=1, product_name='Parrilla familiar', list_price=800, unit_price=800, quantity=1, notes='bien cocida', line_total=800)])
PAYMENTS = [dict(id='pay1', group_id='g-big', method='card', amount=800, reference='Visa 1234', paid_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), orders=PAY_ORDER),
            dict(id='pay2', group_id='g-small', method='cash', amount=29, reference=None, paid_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), orders=dict(ORDER, payment_status='paid'))]
RECEIPTS = []
ROLES = [dict(id=1, name='admin', label='Administrador', permissions=['*'], is_system=True),
         dict(id=2, name='kitchen', label='Cocina', permissions=['orders.view', 'orders.kitchen'], is_system=True)]
USERS = [dict(id='u1', email='admin@test.pe', full_name='Admin', role_id=1, is_active=True, roles=dict(id=1, name='admin', label='Administrador'))]
calls = []
def handler(route, request):
    url = request.url; m = request.method
    if m == 'OPTIONS':
        return route.fulfill(status=204, headers=CORS)
    path = url.split(FAKE)[1]
    body = None
    try: body = request.post_data_json
    except Exception: pass
    obj = 'pgrst.object' in (request.headers.get('accept') or '')
    def ok(data): return route.fulfill(status=200, headers={**CORS, 'content-type': 'application/json'}, body=json.dumps(data))
    if path.startswith('/functions/v1/staff-admin'):
        calls.append(('staff-admin', body)); return ok(dict(user_id='u2'))
    if path.startswith('/rest/v1/rpc/'):
        fn = path.split('/rpc/')[1].split('?')[0]; calls.append((fn, body))
        if fn == 'get_table_by_token': return ok(dict(number=5, name=None, restaurant='Cremoso Test', currency='S/', qr_enabled=True))
        if fn == 'get_table_orders': return ok([])
        if fn == 'create_qr_order': return ok(dict(order_id='o9', order_number=7, status='pending', total=49, duplicate=False))
        if fn == 'get_my_profile': return ok(PROFILE)
        if fn == 'sales_report': return ok(dict(summary=dict(orders=1, total=29, tax=4.42, discounts=1, avg_ticket=29), cancelled=0, by_day=[dict(date='2026-11-23', orders=1, total=29)], by_method=[dict(method='cash', payments=1, total=29)], by_channel=[dict(channel='qr', orders=1, total=29)], top_products=[dict(name='Hamburguesa', quantity=1, total=20)]))
        if fn == 'register_boleta':
            RECEIPTS.append(dict(id='r1', group_id=body['p_group_id'], customer_name=body['p_customer_name'], doc_type=body['p_doc_type'], doc_number=body['p_doc_number'],
                                 items=body['p_items'], total=800, status='prepared', sunat_ref=None, issued_at=None, created_at='2026-11-23T10:00:00Z'))
            return ok(dict(receipt_id='r1', total=800, status='prepared'))
        if fn == 'mark_boleta_issued':
            if not re.match(r'^B[A-Z0-9]{3}-[0-9]{1,8}$', body['p_sunat_ref'].strip().upper()):
                return route.fulfill(status=400, headers={**CORS, 'content-type': 'application/json'}, body=json.dumps(dict(code='P0001', message='INVALID_SUNAT_REF', details=None, hint=None)))
            RECEIPTS[0].update(status='issued', sunat_ref=body['p_sunat_ref'], issued_at='2026-11-23T10:05:00Z')
            return ok(dict(receipt_id='r1', status='issued', sunat_ref=body['p_sunat_ref']))
        if fn == 'create_staff_order': return ok(dict(order_id='o10', order_number=21, status='pending', total=20))
        if fn == 'set_order_status': return ok(dict(order_id='o1', status=body['p_status']))
        return ok({})
    if path.startswith('/auth/v1/token'):
        return ok(dict(access_token='a.b.c', token_type='bearer', expires_in=3600, expires_at=int(time.time()) + 3600, refresh_token='r', user=dict(id='u1', email='admin@test.pe', aud='authenticated', app_metadata={}, user_metadata={}, created_at='2026-01-01T00:00:00Z')))
    if path.startswith('/auth/v1/user'): return ok(dict(id='u1', email='admin@test.pe'))
    table = path.split('/rest/v1/')[1].split('?')[0] if '/rest/v1/' in path else ''
    data = {'restaurant_settings': SETTINGS, 'categories': CATS, 'menu_products': PRODS, 'orders': [ORDER], 'tables': TABLES, 'payments': PAYMENTS, 'receipts': RECEIPTS, 'roles': ROLES, 'users': USERS}.get(table, [])
    if obj and isinstance(data, list): data = data[0] if data else None
    if obj and not isinstance(data, list) and table == 'restaurant_settings': return ok(SETTINGS)
    return ok(data)
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}

errors = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: errors.append(msg)

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=['--no-sandbox'])
        ctx = br.new_context(viewport=dict(width=390, height=800))
        ctx.route(re.compile(r'http://127\.0\.0\.1:54321/.*'), handler)
        ctx.add_init_script('window.print = () => { window.__printed = (window.__printed || 0) + 1 }')
        page = ctx.new_page()
        js_errors = []
        page.on('pageerror', lambda e: js_errors.append(str(e) + ' @ ' + page.url + ' :: ' + (getattr(e, 'stack', '') or '')[:300]))

        # ---- Menú QR (móvil) ----
        page.goto(f'http://127.0.0.1:{PORT}/m/abc123')
        page.wait_for_selector('text=Mesa 5', timeout=10000)
        check(page.locator('text=Hamburguesa').count() > 0, 'QR: se muestra la carta')
        check(page.locator('text=AGOTADO').count() == 1, 'QR: producto agotado marcado y sin botón')
        check(page.locator('text=S/ 9.00').count() > 0, 'QR: precio con promoción (S/ 9.00)')
        page.locator('button:has-text("Agregar")').first.click()
        page.locator('button[aria-label="Agregar uno"]').first.click()
        page.locator('text=Ver mi pedido').click()
        page.fill('input[placeholder^="¿Alguna indicación"]', 'sin cebolla')
        page.locator('button:has-text("Confirmar pedido")').click()
        page.wait_for_selector('text=Pedido #7 enviado', timeout=8000)
        sent = [b for f, b in calls if f == 'create_qr_order'][0]
        check(sent['p_items'] == [dict(product_id='p1', quantity=2, notes='sin cebolla')], 'QR: envía solo product_id/cantidad/nota (sin precios)')
        check(re.match(r'^[0-9a-f-]{36}$', sent['p_request_id']) is not None, 'QR: incluye clave de idempotencia UUID')
        check(sent['p_token'] == 'abc123', 'QR: envía el token de la mesa')

        # ---- Login y pantallas del personal (escritorio) ----
        page.set_viewport_size(dict(width=1366, height=800))
        page.goto(f'http://127.0.0.1:{PORT}/login')
        page.fill('#user', 'admin'); page.fill('#pw', 'secreto123')
        page.locator('button:has-text("Ingresar")').click()
        page.wait_for_url('**/caja', timeout=10000)
        page.wait_for_selector('text=Nuevo pedido', timeout=10000)
        check(page.locator('text=Hamburguesa').count() > 0, 'Caja: muestra la carta para tomar pedidos')
        page.locator('button:has-text("Hamburguesa")').first.click()
        page.locator('button:has-text("5")').first.click()
        check(page.locator('button:has-text("Enviar a cocina")').is_enabled(), 'Caja: con mesa y producto se habilita "Enviar a cocina"')
        # pedido SIN MESA: no exige elegir mesa y envía table_id nulo
        page.locator('button:has-text("Sin mesa")').click()
        check(page.locator('button:has-text("Enviar a cocina")').is_enabled(), 'Caja: "Sin mesa" permite enviar el pedido sin elegir mesa')
        page.locator('button:has-text("Enviar a cocina")').click()
        time.sleep(0.6)
        check(any(f == 'create_staff_order' and b['p_table_id'] is None for f, b in calls), 'Caja: pedido sin mesa llama a create_staff_order con p_table_id nulo')
        page.locator('button:has-text("Cuentas")').first.click()
        page.wait_for_selector('text=Mesa 5', timeout=5000)
        check(page.locator('button:has-text("Cobrar")').count() > 0, 'Caja: la cuenta de la mesa 5 muestra el cobro')

        page.goto(f'http://127.0.0.1:{PORT}/cocina')
        page.wait_for_selector('text=#12', timeout=10000)
        check(page.locator('text=sin cebolla').count() > 0, 'Cocina: muestra observaciones del ítem')
        check(page.locator('text=sin ají').count() > 0, 'Cocina: muestra la nota general')
        page.locator('button:has-text("Iniciar preparación")').click()
        time.sleep(0.5)
        check(any(f == 'set_order_status' and b['p_status'] == 'preparing' for f, b in calls), 'Cocina: "Iniciar preparación" llama a set_order_status(preparing)')

        page.goto(f'http://127.0.0.1:{PORT}/seguimiento')
        page.wait_for_selector('text=#12', timeout=10000)
        check(page.locator('text=QR').count() > 0, 'Seguimiento: muestra el canal de ingreso')


        # ---- Ticket y boleta ----
        page.goto(f'http://127.0.0.1:{PORT}/comprobantes')
        page.wait_for_selector('text=Parrilla', timeout=1) if False else page.wait_for_selector('text=pedidos #13', timeout=10000)
        page.locator('li:has-text("#13") button:has-text("Ticket")').click()
        page.wait_for_selector('#print-root .ticket', state='attached', timeout=5000)
        t = page.locator('#print-root .ticket').inner_text()
        check('Parrilla familiar' in t and 'bien cocida' in t and 'TOTAL' in t and 'S/ 800.00' in t, 'Ticket: incluye producto, observación y total')
        check('Visa 1234' in t and 'Tarjeta' in t, 'Ticket: incluye forma de pago y referencia')
        check('NO ES COMPROBANTE' not in t and 'Si necesita boleta' not in t, 'Ticket: ya no muestra la leyenda de ticket interno')
        check('Comprobante' in t and t.strip().endswith('¡Gracias por su visita!'), 'Ticket: dice Comprobante y cierra con "¡Gracias por su visita!"')
        page.wait_for_function('window.__printed >= 1', timeout=3000)
        check(True, 'Ticket: dispara la impresión')
        # Calendario moderno: abre, navega con teclado y cambia la fecha
        page.goto(f'http://127.0.0.1:{PORT}/comprobantes'); page.wait_for_selector('[data-trigger]', timeout=8000)
        before = page.locator('[data-trigger]').inner_text()
        page.click('[data-trigger]'); page.wait_for_selector('[role=dialog][aria-label="Elegir fecha"]', timeout=3000); time.sleep(0.4)
        check(page.locator('[role=gridcell]').count() == 42, 'Calendario: muestra 6 semanas (42 días)')
        if os.environ.get('SHOTS'): page.screenshot(path='/tmp/shot_calendar.png')
        page.keyboard.press('ArrowLeft'); page.keyboard.press('Enter'); time.sleep(0.4)
        after = page.locator('[data-trigger]').inner_text()
        check(after != before and page.locator('[role=dialog][aria-label="Elegir fecha"]').count() == 0, 'Calendario: flecha izquierda + Enter elige el día anterior y se cierra')
        page.click('[data-trigger]'); page.wait_for_selector('[role=dialog][aria-label="Elegir fecha"]'); page.keyboard.press('Escape'); time.sleep(0.3)
        check(page.locator('[role=dialog][aria-label="Elegir fecha"]').count() == 0, 'Calendario: Esc lo cierra')
        if os.environ.get('SHOTS'):
            page.emulate_media(media='print'); page.screenshot(path='/tmp/ticket.png', clip=dict(x=450, y=0, width=470, height=760)); page.emulate_media(media='screen')
        page.evaluate("document.getElementById('print-root')?.remove()")

        # boleta > S/ 700: pide documento
        page.locator('li:has-text("#13") button:has-text("Boleta")').click()
        page.wait_for_selector('text=Preparar boleta de venta')
        page.fill('input[placeholder="Nombres y apellidos"]', 'Luis Gómez')
        check(page.locator('button:has-text("Guardar datos de la boleta")').is_disabled(), 'Boleta > S/ 700: sin documento no se puede guardar')
        check(page.locator('text=SUNAT exige').count() > 0, 'Boleta > S/ 700: avisa que exige documento')
        page.select_option('select', 'DNI'); page.fill('input[maxlength="12"]', '87654321')
        # romper la suma y verificar bloqueo
        page.fill('input[aria-label="Monto en soles"]', '799')
        check(page.locator('button:has-text("Guardar datos de la boleta")').is_disabled(), 'Boleta: la suma distinta al total bloquea el guardado')
        page.fill('input[aria-label="Monto en soles"]', '800')
        page.locator('button:has-text("Guardar datos de la boleta")').click()
        page.wait_for_selector('text=falta emitirla en SUNAT', timeout=8000)
        sent = [b for f, b in calls if f == 'register_boleta'][0]
        check(sent['p_customer_name'] == 'Luis Gómez' and sent['p_doc_type'] == 'DNI' and sent['p_doc_number'] == '87654321', 'Boleta: envía nombre y documento')
        check(sent['p_items'] == [dict(product='Parrilla familiar', quantity=1, amount=800)], 'Boleta: envía Producto, Cantidad y Monto en soles')
        page.fill('input[placeholder^="Serie-número"]', 'F001-5')
        page.locator('button:has-text("Registrar emitida")').click()
        time.sleep(0.5)
        check(page.locator('text=Escribe la serie y el número').count() > 0, 'Boleta: una serie de factura (F001) es rechazada con mensaje claro')
        page.fill('input[placeholder^="Serie-número"]', 'b001-123')
        page.locator('button:has-text("Registrar emitida")').click()
        page.wait_for_selector('text=Boleta B001-123', timeout=8000)
        check(True, 'Boleta: queda marcada como emitida (B001-123)')
        page.locator('button:has-text("Cerrar")').last.click()

        # boleta <= S/ 700: basta el nombre
        page.locator('li:has-text("#12") button:has-text("Boleta")').click()
        page.wait_for_selector('text=Preparar boleta de venta')
        page.fill('input[placeholder="Nombres y apellidos"]', 'Ana Pérez')
        check(page.locator('button:has-text("Guardar datos de la boleta")').is_enabled(), 'Boleta ≤ S/ 700: basta el nombre del cliente')
        page.keyboard.press('Escape')

        # pre-cuenta desde caja
        page.goto(f'http://127.0.0.1:{PORT}/caja')
        page.wait_for_selector('text=Nuevo pedido', timeout=10000)
        page.locator('button:has-text("Cuentas")').first.click()
        page.wait_for_selector('button:has-text("Pre-cuenta")', timeout=5000)
        page.locator('button:has-text("Pre-cuenta")').first.click()
        page.wait_for_selector('#print-root .ticket', state='attached', timeout=5000)
        check('PRE-CUENTA' in page.locator('#print-root .ticket').inner_text(), 'Caja: la pre-cuenta se imprime con su título')

        for route in ['/carta', '/mesas', '/reportes', '/usuarios', '/ajustes', '/comprobantes']:
            page.goto(f'http://127.0.0.1:{PORT}{route}'); page.wait_for_selector('header', timeout=8000); time.sleep(0.8)
            check(page.locator('header').count() > 0, f'{route}: la pantalla carga sin romperse')
        # Personal: crear usuario (usuario + contraseña) y puesto desde la app
        page.goto(f'http://127.0.0.1:{PORT}/usuarios'); page.wait_for_selector('text=Crear usuario', timeout=8000)
        page.fill('#nu-user', 'cocina1'); page.fill('#nu-name', 'Cocina Uno'); page.fill('#nu-pw', 'clave12345'); page.select_option('#nu-role', '2')
        page.locator('button:has-text("Crear")').last.click(); time.sleep(0.8)
        sa = [b for f, b in calls if f == 'staff-admin']
        check(bool(sa) and sa[-1]['action'] == 'create' and sa[-1]['username'] == 'cocina1' and sa[-1]['role_id'] == 2, 'Personal: crear usuario llama a la función staff-admin con usuario, contraseña y puesto')
        page.locator('button:has-text("Nuevo puesto")').click(); page.wait_for_selector('text=Nuevo puesto >> nth=1', timeout=3000)
        page.fill('#role-label', 'Barista'); page.locator('label:has-text("Tomar pedidos") input').check()
        page.locator('button:has-text("Guardar")').last.click(); time.sleep(0.6)
        check(any(f == 'admin_save_role' and b['p_label'] == 'Barista' and 'orders.create' in b['p_permissions'] for f, b in calls), 'Personal: crear puesto llama a admin_save_role con sus permisos')
        if os.environ.get('SHOTS'):
            page.goto(f'http://127.0.0.1:{PORT}/usuarios'); page.wait_for_selector('text=Crear usuario'); time.sleep(0.6); page.screenshot(path='/tmp/shot_users.png', full_page=True)
            page.goto(f'http://127.0.0.1:{PORT}/caja'); page.wait_for_selector('text=Nuevo pedido'); time.sleep(0.6); page.screenshot(path='/tmp/shot_caja.png', full_page=True)
            page.evaluate("localStorage.clear(); sessionStorage.clear()"); page.goto(f'http://127.0.0.1:{PORT}/login'); page.wait_for_selector('#user'); time.sleep(0.6); page.screenshot(path='/tmp/shot_login.png')
        check(not js_errors, 'Sin errores de JavaScript en ninguna pantalla' + (f' -> {js_errors[:3]}' if js_errors else ''))
        br.close()
finally:
    os.killpg(os.getpgid(srv.pid), signal.SIGTERM)
    os.remove(cfg) if os.path.exists(cfg) else None

print('\nRESULTADO:', 'TODO OK' if not errors else f'{len(errors)} FALLO(S)')
sys.exit(1 if errors else 0)
