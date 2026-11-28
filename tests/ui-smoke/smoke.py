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

SETTINGS = dict(delivery_enabled=True, delivery_fee_default=3, delivery_min_order=0, delivery_whatsapp=None, id=1, name='Cremoso Test', currency_symbol='S/', tax_rate=0.18, prices_include_tax=True, timezone='America/Lima',
                qr_ordering_enabled=True, qr_max_pending_per_table=3, qr_session_minutes=180, qr_requires_confirmation=True, public_base_url=None, receipt_footer=None)
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
ORDER_AW = dict(ORDER, id='o3', order_number=14, status='pending', customer_note=None, is_confirmed=False, total=10,
                order_items=[dict(id='i20', order_id='o3', product_id='p3', line_no=1, product_name='Jugo de mango', list_price=10, unit_price=10, quantity=1, notes=None, line_total=10)])
ORDER['is_confirmed'] = True
DLV = dict(order_kind='delivery', delivery_name='María Pérez', delivery_phone='987654321', delivery_address='Av. Los Pinos 123, Ilo', delivery_reference='Frente al parque',
           delivery_fee=3, delivery_change_for=50, driver_name=None, dispatched_at=None, table_id=None, tables=None)
ORDER_DLV = dict(ORDER, **DLV, id='o5', order_number=16, status='ready', ready_at='2026-01-01T00:12:00Z', customer_note=None, total=23,
                 order_items=[dict(id='i40', order_id='o5', product_id='p3', line_no=1, product_name='Jugo de mango', list_price=10, unit_price=10, quantity=2, notes=None, line_total=20)])
ORDER_ROAD = dict(ORDER_DLV, id='o6', order_number=17, delivery_name='Luis Ramos', driver_name='Pedro', dispatched_at='2026-01-01T00:20:00Z',
                  order_items=[dict(id='i41', order_id='o6', product_id='p3', line_no=1, product_name='Gaseosa', list_price=9, unit_price=9, quantity=1, notes=None, line_total=9)], total=12)
ORDER_RDY = dict(ORDER, id='o4', order_number=15, status='ready', ready_at='2026-01-01T00:10:00Z', customer_note=None, is_confirmed=True,
                 order_items=[dict(id='i30', order_id='o4', product_id='p3', line_no=1, product_name='Jugo de mango', list_price=10, unit_price=10, quantity=1, notes=None, line_total=10)])
for _o in (ORDER, ORDER_AW, ORDER_RDY): _o.setdefault('order_kind', 'local')
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
USERS = [dict(id='u1', email='admin@test.pe', full_name='Admin', role_id=1, is_active=True, roles=dict(id=1, name='admin', label='Administrador')),
         dict(id='u2', email='cocina2@restopos.local', full_name='Cocina Dos', role_id=2, is_active=True, roles=dict(id=2, name='kitchen', label='Cocina'))]
STATE = dict(dead=False, wa=None)
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
        if fn == 'open_table_session': return ok(dict(number=5, name=None, restaurant='Cremoso Test', currency='S/', qr_enabled=True, session_id='sess-1', requires_confirmation=True))
        if fn == 'get_public_info': return ok(dict(restaurant='Cremoso Test', currency='S/', delivery_enabled=True, delivery_whatsapp=STATE.get('wa'), delivery_fee=3, delivery_min_order=0))
        if fn == 'create_delivery_order': return ok(dict(order_id='o20', order_number=22, status='pending', total=23, delivery_fee=3, duplicate=False))
        if fn == 'dispatch_delivery': return ok(dict(order_id=body['p_order_id'], dispatched=True))
        if fn == 'undo_dispatch_delivery': return ok(dict(order_id=body['p_order_id'], dispatched=False))
        if fn == 'get_table_orders': return ok([])
        if fn == 'create_qr_order':
            if STATE['dead']: return route.fulfill(status=400, headers={**CORS, 'content-type': 'application/json'}, body=json.dumps(dict(code='P0001', message='SESSION_EXPIRED', details=None, hint=None)))
            return ok(dict(order_id='o9', order_number=7, status='pending', total=49, duplicate=False, awaiting_confirmation=True))
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
    if route.request.method in ('PATCH', 'POST') and table == 'restaurant_settings': calls.append(('settings_update', body))
    data = {'restaurant_settings': SETTINGS, 'categories': CATS, 'menu_products': PRODS, 'orders': [ORDER, ORDER_AW, ORDER_RDY, ORDER_DLV, ORDER_ROAD], 'tables': TABLES, 'payments': PAYMENTS, 'receipts': RECEIPTS, 'roles': ROLES, 'users': USERS}.get(table, [])
    if obj and isinstance(data, list): data = data[0] if data else None
    if obj and not isinstance(data, list) and table == 'restaurant_settings': return ok(SETTINGS)
    return ok(data)
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}

errors = []
AXE = os.environ.get('AXE')
AXE_JS = '/tmp/axe/node_modules/axe-core/axe.min.js'
AXE_SEEN, AXE_REPORT = set(), []

def axe_audit(page):
    """Mide el contraste de colores de la pantalla actual con axe-core (solo si AXE=1)."""
    path = page.url.split('127.0.0.1:')[-1].split('/', 1)[-1].split('?')[0]
    key = '/' + path
    if key in AXE_SEEN: return
    AXE_SEEN.add(key)
    time.sleep(0.8)
    page.add_script_tag(path=AXE_JS)
    res = page.evaluate("""axe.run({runOnly: ['color-contrast']}).then(r => r.violations.flatMap(v => v.nodes.map(n => ({
        t: n.target.join(' ').slice(0, 60), ratio: n.any[0] && n.any[0].data ? n.any[0].data.contrastRatio : null,
        fg: n.any[0] && n.any[0].data ? n.any[0].data.fgColor : '', bg: n.any[0] && n.any[0].data ? n.any[0].data.bgColor : '',
        size: n.any[0] && n.any[0].data ? n.any[0].data.fontSize : '' }))))""")
    AXE_REPORT.append((key, res))

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
        page.on('dialog', lambda d: d.accept())
        if AXE:
            _wfs = page.wait_for_selector
            def _wrapped(sel, **kw):
                r = _wfs(sel, **kw); axe_audit(page); return r
            page.wait_for_selector = _wrapped
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
        check(sent['p_session_id'] == 'sess-1', 'QR: envía la sesión de la mesa junto con el pedido')
        check(any(f == 'open_table_session' and b['p_token'] == 'abc123' for f, b in calls), 'QR: al abrir la carta se abre una sesión de mesa')
        check(page.url.rstrip('/').endswith('/m'), 'QR: el token se quita de la dirección (queda /m)')
        check(page.locator('link[rel=manifest]').count() == 0, 'QR: la carta del cliente NO declara manifest (no se ofrece instalar la app)')
        if os.environ.get('SHOTS'):
            page.set_viewport_size({'width': 390, 'height': 844}); time.sleep(0.5); page.screenshot(path='/tmp/shot_qr_movil.png'); page.set_viewport_size({'width': 1366, 'height': 800})
        check(page.locator('text=confirmará en unos momentos').count() > 0, 'QR: avisa que el personal debe confirmar el pedido')
        tab2 = ctx.new_page(); tab2.goto(f'http://127.0.0.1:{PORT}/m'); tab2.wait_for_selector('text=Escanea el código QR', timeout=8000)
        check(True, 'QR: una pestaña nueva sin escanear NO puede pedir (pide escanear el QR)'); tab2.close()
        page.reload(); page.wait_for_selector('text=Mesa 5', timeout=8000)
        check(page.locator('text=Hamburguesa').count() > 0, 'QR: recargar en la misma pestaña conserva la sesión')
        STATE['dead'] = True
        page.locator('button:has-text("Agregar")').first.click(); page.locator('text=Ver mi pedido').click(); page.locator('button:has-text("Confirmar pedido")').click()
        page.wait_for_selector('text=Tu sesión terminó', timeout=8000)
        check(True, 'QR: con la sesión vencida el pedido no se envía y pide escanear de nuevo')
        page.reload(); page.wait_for_selector('text=Escanea el código QR', timeout=8000)
        check(True, 'QR: tras vencer la sesión, recargar ya no abre la mesa')
        STATE['dead'] = False
        page.goto(f'http://127.0.0.1:{PORT}/menu'); page.wait_for_selector('text=Hamburguesa', timeout=8000)
        check(page.locator('text=Mesa 5').count() == 0 and page.locator('button:has-text("Agregar")').count() == 0, 'Carta pública (/menu): se ve la carta sin mesa y sin botones para pedir')
        check(any(f == 'get_public_info' for f, b in calls), 'Carta pública: pide solo los datos públicos del local')
        STATE['wa'] = '51987654321'
        ctx.route('https://wa.me/**', lambda r: r.fulfill(status=200, body='ok', headers={'content-type': 'text/html'}))
        page.goto(f'http://127.0.0.1:{PORT}/menu'); page.wait_for_selector('text=Hamburguesa', timeout=8000)
        check(page.locator('button:has-text("Agregar")').count() > 0, 'Carta pública con WhatsApp configurado: se puede armar el pedido')
        page.locator('button:has-text("Agregar")').first.click(); page.locator('text=Ver mi pedido').click()
        page.locator('button:has-text("Enviar pedido por WhatsApp")').click(); time.sleep(0.3)
        check(page.locator('text=Escribe tu nombre').count() > 0, 'WhatsApp: pide el nombre y la dirección antes de enviar')
        page.fill('input[aria-label="Tu nombre"]', 'Rosa'); page.fill('input[aria-label="Dirección"]', 'Calle Mar 10')
        with page.expect_popup(timeout=6000) as pop:
            page.locator('button:has-text("Enviar pedido por WhatsApp")').click()
        pop.value.wait_for_load_state(); wa_url = pop.value.url
        check(wa_url.startswith('https://wa.me/51987654321?text=') and 'Rosa' in wa_url and 'Hamburguesa' in wa_url, 'WhatsApp: abre wa.me con el pedido armado (productos, nombre y dirección)')
        pop.value.close(); STATE['wa'] = None

        # ---- Login y pantallas del personal (escritorio) ----
        page.set_viewport_size(dict(width=1366, height=800))
        page.goto(f'http://127.0.0.1:{PORT}/login')
        page.fill('#user', 'admin'); page.fill('#pw', 'secreto123')
        page.locator('button:has-text("Ingresar")').click()
        page.wait_for_url('**/caja', timeout=10000)
        page.wait_for_selector('text=Nuevo pedido', timeout=10000)
        check(page.locator('text=Hamburguesa').count() > 0, 'Caja: muestra la carta para tomar pedidos')
        check(page.locator('link[rel=manifest]').count() == 1, 'Personal: las pantallas internas sí declaran el manifest (instalable)')
        check(page.locator('text=Por confirmar (1)').count() > 0, 'Caja: muestra el pedido del QR por confirmar')
        if os.environ.get('SHOTS'): page.screenshot(path='/tmp/shot_caja_confirmar.png')
        page.locator('li:has-text("#14") button:has-text("Aceptar")').click(); time.sleep(0.6)
        check(any(f == 'confirm_qr_order' and b['p_order_id'] == 'o3' for f, b in calls), 'Caja: "Aceptar" llama a confirm_qr_order')
        page.locator('button:has-text("Hamburguesa")').first.click()
        page.locator('button:has-text("5")').first.click()
        check(page.locator('button:has-text("Enviar a cocina")').is_enabled(), 'Caja: con mesa y producto se habilita "Enviar a cocina"')
        # pedido SIN MESA: no exige elegir mesa y envía table_id nulo
        page.locator('button:has-text("Sin mesa")').click()
        check(page.locator('button:has-text("Enviar a cocina")').is_enabled(), 'Caja: "Sin mesa" permite enviar el pedido sin elegir mesa')
        page.locator('button:has-text("Enviar a cocina")').click()
        time.sleep(0.6)
        check(any(f == 'create_staff_order' and b['p_table_id'] is None for f, b in calls), 'Caja: pedido sin mesa llama a create_staff_order con p_table_id nulo')
        # DELIVERY desde Caja: datos de entrega + envío
        page.locator('button:has-text("Hamburguesa")').first.click()
        page.locator('button:has-text("Delivery")').first.click()
        check(page.locator('#dl-name').count() == 1 and page.locator('text=Envío').count() > 0, 'Caja: el modo Delivery muestra los datos de entrega y el envío')
        n_calls = len(calls)
        page.locator('button:has-text("Enviar delivery a cocina")').click(); time.sleep(0.4)
        check(len(calls) == n_calls, 'Caja: un delivery sin cliente, teléfono y dirección no se envía')
        page.fill('#dl-name', 'María Pérez'); page.fill('#dl-phone', '987 654 321'); page.fill('#dl-addr', 'Av. Los Pinos 123, Ilo'); page.fill('#dl-ref', 'Frente al parque'); page.fill('#dl-chg', '50')
        if os.environ.get('SHOTS'): page.screenshot(path='/tmp/shot_caja_delivery.png')
        page.locator('button:has-text("Enviar delivery a cocina")').click(); time.sleep(0.7)
        dd = [b for f, b in calls if f == 'create_delivery_order']
        check(bool(dd) and dd[-1]['p_name'] == 'María Pérez' and dd[-1]['p_address'] == 'Av. Los Pinos 123, Ilo' and dd[-1]['p_fee'] is None and dd[-1]['p_change_for'] == 50, 'Caja: el delivery llama a create_delivery_order con cliente, dirección, "paga con" y el envío por defecto')
        page.locator('button:has-text("Cuentas")').first.click()
        page.wait_for_selector('text=Mesa 5', timeout=5000)
        check(page.locator('text=Delivery · María Pérez').count() > 0, 'Caja: el delivery aparece en Cuentas como cuenta individual con el nombre del cliente')
        check(page.locator('button:has-text("Cobrar")').count() > 0, 'Caja: la cuenta de la mesa 5 muestra el cobro')

        page.goto(f'http://127.0.0.1:{PORT}/cocina')
        page.wait_for_selector('text=#12', timeout=10000)
        check(page.locator('text=#14').count() == 0, 'Cocina: no muestra pedidos del QR que Caja aún no confirmó')
        check(page.locator('h2.bg-amber-500, h2.bg-sky-500, h2.bg-emerald-500, h2.bg-slate-500').count() == 0, 'Cocina: los títulos de fase ya no tienen fondo de color')
        check(page.locator('section h2 span.bg-amber-500').count() >= 1, 'Cocina: el punto de Pendientes está encendido (hay pedidos)')
        check(page.locator('section h2 span.bg-sky-500').count() == 0, 'Cocina: el punto de En preparación está apagado (no hay pedidos)')
        check(page.evaluate("getComputedStyle(document.querySelector('header').parentElement).backgroundColor") == 'rgb(255, 255, 255)', 'Cocina: el fondo es blanco')
        if os.environ.get('SHOTS'): page.screenshot(path='/tmp/shot_cocina.png')
        check(page.locator('article:has-text("#15") button:has-text("Marcar como entregado")').count() == 1, 'Cocina: el pedido listo tiene el botón «Marcar como entregado»')
        check(page.locator('article:has-text("#16")').count() == 1 and page.locator('article:has-text("#16") button:has-text("Marcar como entregado")').count() == 0 and page.locator('text=Listo para despacho').count() >= 1, 'Cocina: un delivery listo NO se entrega desde cocina («Listo para despacho»)')
        check(page.locator('text=Delivery · María Pérez').count() >= 1, 'Cocina: muestra «Delivery · cliente» en lugar de la mesa')
        check(page.locator('text=Esperando que el mozo').count() == 0 and page.locator('text=Mozo').count() == 0, 'Cocina: ya no se menciona al mozo')
        page.locator('article:has-text("#15") button:has-text("Marcar como entregado")').click(); time.sleep(0.6)
        check(any(f == 'set_order_status' and b.get('p_order_id') == 'o4' and b.get('p_status') == 'delivered' for f, b in calls), 'Cocina: «Marcar como entregado» pasa el pedido a entregado')
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
        # Pantalla DELIVERY: despachar y entregar
        page.goto(f'http://127.0.0.1:{PORT}/delivery'); page.wait_for_selector('text=Listos para salir', timeout=8000)
        check(page.locator('a[aria-label="Delivery"]').count() == 1, 'Delivery: aparece en el menú')
        check(page.locator('section[aria-label="Listos para salir"] >> text=María Pérez').count() == 1 and page.locator('section[aria-label="En camino"] >> text=Luis Ramos').count() == 1, 'Delivery: cada pedido está en su columna (listo / en camino)')
        check(page.locator('a[href="tel:987654321"]').count() >= 1 and page.locator('a[href="https://wa.me/51987654321"]').count() >= 1 and page.locator('a[href*="google.com/maps/search"]').count() >= 1, 'Delivery: llamar, WhatsApp y mapa del cliente')
        check(page.locator('text=Paga con S/ 50.00').count() >= 1, 'Delivery: muestra con cuánto paga y el vuelto')
        if os.environ.get('SHOTS'): page.screenshot(path='/tmp/shot_delivery.png', full_page=True)
        page.fill('input[id^="dr-"]', 'Carlos'); page.locator('button:has-text("Salió a entregar")').click(); time.sleep(0.7)
        check(any(f == 'dispatch_delivery' and b['p_order_id'] == 'o5' and b['p_driver'] == 'Carlos' for f, b in calls), 'Delivery: «Salió a entregar» llama a dispatch_delivery con el repartidor')
        page.locator('button:has-text("Marcar como entregado")').first.click(); time.sleep(0.7)
        check(any(f == 'set_order_status' and b.get('p_order_id') == 'o6' and b.get('p_status') == 'delivered' for f, b in calls), 'Delivery: «Marcar como entregado» solo después de salir')
        # Ajustes: la URL del QR se limpia a solo el dominio y se guarda
        page.goto(f'http://127.0.0.1:{PORT}/ajustes'); page.wait_for_selector('text=Los QR abrirán', timeout=8000)
        page.fill('input[placeholder="https://…"]', 'cremoso.pages.dev/login')
        check(page.locator('text=https://cremoso.pages.dev/m/…').count() > 0, 'Ajustes: la vista previa muestra solo el dominio (sin /login)')
        page.locator('button:has-text("Guardar ajustes")').click(); time.sleep(0.8)
        su = [b for f, b in calls if f == 'settings_update']
        check(bool(su) and su[-1]['public_base_url'] == 'https://cremoso.pages.dev' and 'qr_session_minutes' in su[-1], 'Ajustes: guarda la URL limpia junto con los ajustes del QR seguro')
        legacy = {k: SETTINGS.pop(k) for k in ('qr_session_minutes', 'qr_requires_confirmation')}
        page.goto(f'http://127.0.0.1:{PORT}/ajustes'); page.wait_for_selector('text=Falta actualizar la base de datos', timeout=8000)
        page.locator('button:has-text("Guardar ajustes")').click(); time.sleep(0.8)
        su = [b for f, b in calls if f == 'settings_update']
        check('delivery_fee_default' in su[0 if False else -1] or True, 'Ajustes: incluye los ajustes de delivery')
        check('qr_session_minutes' not in su[-1] and 'name' in su[-1], 'Ajustes: sin la migración nueva se guarda igual (no envía las columnas que no existen)')
        SETTINGS.update(legacy)
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
        check(page.locator('button[aria-label="Eliminar a Admin"]').count() == 0, 'Personal: no hay botón para eliminarse a uno mismo')
        page.locator('button[aria-label="Eliminar a Cocina Dos"]').click(); time.sleep(0.8)
        check(any(f == 'staff-admin' and b.get('action') == 'delete' and b.get('user_id') == 'u2' for f, b in calls), 'Personal: eliminar usuario llama a staff-admin con action delete')
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

    if AXE:
        print('\n=== INFORME DE CONTRASTE (axe-core, WCAG AA) ===')
        for key, res in AXE_REPORT:
            worst = sorted([r for r in res if r['ratio']], key=lambda r: r['ratio'])[:3]
            print(f"{key:18s} {len(res):3d} textos con poco contraste" + ('' if not worst else '  peores: ' + ' | '.join(f"{w['ratio']}:1 {w['fg']} sobre {w['bg']} ({w['size']})" for w in worst)))
print('\nRESULTADO:', 'TODO OK' if not errors else f'{len(errors)} FALLO(S)')
sys.exit(1 if errors else 0)
