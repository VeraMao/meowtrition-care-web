# Usage: VITE_SUPABASE_URL=http://fake.supabase.test VITE_SUPABASE_ANON_KEY=anon npx vite --port 4173  (dev server: no /api, so "Create" uses the local template), then `python3 tests/e2e_smoke.py`.
# Smoke test: real built app, Supabase faked in-memory at the network layer.
import json, re, time, uuid, urllib.parse as up
from playwright.sync_api import sync_playwright

USER = {"id": "00000000-0000-0000-0000-00000000000a", "email": "vera@test.dev", "aud": "authenticated", "role": "authenticated",
        "app_metadata": {}, "user_metadata": {}, "created_at": "2026-11-16T00:00:00Z"}
DB = {t: [] for t in ["profiles","cats","foods","feeding_logs","hydration_logs","litter_logs","weight_logs","vet_visits","care_reports","medications","medication_logs","api_keys","report_generations"]}
DB["profiles"].append({"id": USER["id"], "timezone": "America/Chicago"})
DEFAULTS = {"cats": {"sex":"unknown","is_demo":False,"archived_at":None,"daily_kcal_target":None,"birth_date":None,"neutered":None,"estimated_age_months":None},
            "litter_logs": {"symptoms": []}, "medications": {"archived_at": None, "end_date": None, "start_date": None},
            "medication_logs": {"status": "given"}}

def session():
    return {"access_token":"tok","token_type":"bearer","expires_in":3600,"expires_at":int(time.time())+3600,"refresh_token":"r","user":USER}

def match(row, k, cond):
    op, _, val = cond.partition(".")
    v = row.get(k)
    if op == "eq": return str(v).lower() == val.lower() if isinstance(v,bool) else str(v) == val
    if op == "is": return v is None if val == "null" else False
    if op == "not": return v is not None if val == "is.null" else True
    if op == "gte": return v is not None and str(v) >= val
    if op == "lt": return v is not None and str(v) < val
    return True

def filt(rows, q):
    out = rows
    for k, vals in q.items():
        if k in ("select","order","limit","on_conflict","columns"): continue
        for cond in vals:
            if k == "or":
                parts = cond.strip("()").split(",")
                out = [r for r in out if any(match(r, p.split(".",1)[0], p.split(".",1)[1]) for p in parts)]
            else:
                out = [r for r in out if match(r, k, cond)]
    if "order" in q:
        for part in reversed(q["order"][0].split(",")):          # multi-key: apply last key first (stable sort)
            col, _, d = part.partition(".")
            out = sorted(out, key=lambda r: str(r.get(col) or ""), reverse=d.startswith("desc"))
    if "limit" in q: out = out[: int(q["limit"][0])]
    return out

def handle(route):
    req = route.request; u = up.urlparse(req.url); q = up.parse_qs(u.query); p = u.path
    J = lambda body, s=200: route.fulfill(status=s, content_type="application/json", body=json.dumps(body))
    if p.startswith("/auth/v1/token"): return J(session())
    if p == "/auth/v1/user": return J(USER)
    if p == "/auth/v1/logout": return route.fulfill(status=204)
    if p == "/rest/v1/rpc/report_quota": return J(QUOTA)
    m = re.match(r"/rest/v1/(\w+)", p)
    if not m: return J({}, 404)
    t = m.group(1); rows = DB[t]
    single = "vnd.pgrst.object" in (req.headers.get("accept") or "")
    if req.method == "GET":
        res = filt(rows, q)
        return J((res[0] if res else None) if single else res)
    if req.method == "POST":
        body = json.loads(req.post_data or "{}"); items = body if isinstance(body, list) else [body]; out = []
        for it in items:
            if "on_conflict" in q:
                keys = q["on_conflict"][0].split(",")
                ex = next((r for r in rows if all(r.get(k) == it.get(k, USER["id"] if k=="owner_id" else None) for k in keys)), None)
                if ex: ex.update(it); out.append(ex); continue
            r = {"amount": None, "amount_unit": None, "kcal_basis": None, "kcal_per_kg": None, "kcal_per_cup": None, "kcal_per_unit": None, "unit_name": None, "id": str(uuid.uuid4()), "owner_id": USER["id"], "created_at": "%.6f" % time.time(), **DEFAULTS.get(t, {}), **it}
            rows.append(r); out.append(r)
        return J(out[0] if single else out, 201)
    if req.method == "PATCH":
        body = json.loads(req.post_data); res = filt(rows, q)
        for r in res: r.update(body)
        return J((res[0] if res else None) if single else res, 200)
    if req.method == "DELETE":
        res = filt(rows, q)
        for r in res: rows.remove(r)
        return J(res, 200)
    return J({}, 400)

QUOTA = {"used": 0, "limit": 3, "next_available_at": None, "last_generated_at": None, "has_new_data": True}
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page(viewport={"width": 390, "height": 844})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("http://fake.supabase.test/**", handle)
    pg.route("**/api/care-review", lambda r: r.fulfill(status=404, body="nope"))
    pg.goto("http://localhost:4173")
    pg.screenshot(path="/tmp/e2e_1_login.png")
    pg.get_by_label("Email").fill("vera@test.dev"); pg.get_by_label("Password").fill("secret123")
    pg.get_by_role("button", name="Sign in").click()
    pg.get_by_text("Add your first cat").wait_for()
    pg.get_by_label("Name").fill("Mochi"); pg.get_by_label("Daily kcal target (optional)").fill("200")
    pg.get_by_role("tab", name="Yes").click(); pg.get_by_role("tab", name="Female").click(); pg.wait_for_timeout(300)
    assert len(DB["cats"]) == 0, "BUG1: segmented toggle submitted the cat form"
    pg.get_by_role("button", name="Save", exact=True).click()
    pg.get_by_role("link", name="Home").wait_for()
    pg.screenshot(path="/tmp/e2e_2_profile.png")
    pg.get_by_role("link", name="Home").click()
    pg.get_by_text("Not logged yet").wait_for()
    pg.get_by_role("link", name="+ Food").click()
    # wet food: label says 85 kcal per can; cat ate half
    pg.get_by_role("button", name="+ Add a food").click()
    pg.get_by_label("Name", exact=True).fill("Tiki Cat Chicken")
    pg.get_by_label("kcal per can, pouch or treat").fill("85"); pg.get_by_label("Per what").select_option("can")
    pg.get_by_role("button", name="Add food").click()
    kcal = pg.get_by_label("kcal actually eaten"); kcal.wait_for(); pg.wait_for_timeout(300)
    assert kcal.input_value() == "85", repr(kcal.input_value())
    pg.get_by_role("button", name="½", exact=True).click()
    assert kcal.input_value() == "42.5", repr(kcal.input_value())
    pg.get_by_role("button", name="Save", exact=True).click()
    pg.get_by_text("42.5 kcal · ½ can · Tiki Cat Chicken").wait_for()
    pg.wait_for_timeout(500); assert pg.get_by_label("kcal actually eaten").input_value() == "", "form should reset after save"

    # dry food: bag prints BOTH 3,850 kcal/kg and 412 kcal/cup -> can log in cups or grams
    pg.get_by_role("button", name="+ Add a food").click()
    pg.get_by_label("Name", exact=True).fill("Indoor Dry")
    pg.get_by_label("kcal per kg").fill("3,850"); pg.get_by_label("kcal per cup").fill("412")
    pg.get_by_role("button", name="Add food").click()
    kcal = pg.get_by_label("kcal actually eaten"); kcal.wait_for(); pg.wait_for_timeout(300)
    assert kcal.input_value() == "412", repr(kcal.input_value())
    pg.get_by_role("button", name="¼", exact=True).click(); assert kcal.input_value() == "103"
    pg.get_by_role("tab", name="Grams").click()
    pg.get_by_label("How much was eaten (g)").fill("30")
    assert kcal.input_value() == "115.5", repr(kcal.input_value())
    pg.get_by_role("button", name="Save", exact=True).click()
    pg.get_by_text("115.5 kcal · 30 g · Indoor Dry").wait_for()

    # the C/D mistake: a kcal/kg number typed into kcal/cup gets caught
    pg.get_by_role("button", name="+ Add a food").click()
    pg.get_by_label("Name", exact=True).fill("C/D"); pg.get_by_label("kcal per cup").fill("3,286")
    pg.get_by_text("This looks like a kcal per kg number").wait_for(); pg.screenshot(path="/tmp/e2e_food_form.png", full_page=True)
    pg.get_by_role("button", name="Add food").click()
    pg.get_by_text("Tap Save again").wait_for()
    assert not any(f["name"] == "C/D" for f in DB["foods"]), "warning should block the first save"
    pg.get_by_role("button", name="Add food").click()          # owner insists -> saved, but flagged
    pg.get_by_text("Fix the label numbers").wait_for()
    pg.get_by_role("button", name="Fix the label numbers").click()
    pg.get_by_label("kcal per cup").fill(""); pg.get_by_label("kcal per kg").fill("3,286")
    pg.get_by_role("button", name="Save food").click()
    pg.get_by_role("button", name="edit food").wait_for()
    assert pg.get_by_text("Fix the label numbers").count() == 0
    cd = next(f for f in DB["foods"] if f["name"] == "C/D")
    assert cd["kcal_per_kg"] == 3286 and cd["kcal_per_cup"] is None, cd
    pg.get_by_role("button", name="change").click()

    # saved foods are a list; most recently used first
    pg.get_by_role("list", name="Your foods").get_by_role("button", name=re.compile("Indoor Dry")).wait_for()
    items = pg.get_by_role("list", name="Your foods").get_by_role("button").all_inner_texts()
    assert "Indoor Dry" in items[0] and "Tiki Cat Chicken" in items[1], items
    assert "3,850 kcal/kg · 412 kcal/cup" in items[0] and "85 kcal/can" in items[1], items
    pg.screenshot(path="/tmp/e2e_3_log_food.png", full_page=True)
    pg.get_by_role("tab", name="Water").click()
    pg.get_by_label("Water (mL)").fill("60")
    pg.get_by_role("tab", name="Bowl before − after").click(); pg.get_by_role("tab", name="Estimated drunk").click(); pg.wait_for_timeout(300)
    assert len(DB["hydration_logs"]) == 0, "BUG2: water method toggle submitted the form"
    pg.get_by_role("button", name="Save", exact=True).click(); pg.get_by_text("60 mL").wait_for()
    assert len(DB["hydration_logs"]) == 1
    pg.get_by_role("tab", name="Litter").click()
    pg.get_by_role("button", name="Increase urine clumps").click(); pg.get_by_role("button", name="Increase urine clumps").click()
    pg.get_by_role("button", name="Straining").click()
    pg.get_by_text("Contact your vet or an emergency clinic now").wait_for(); pg.wait_for_timeout(600)
    pg.screenshot(path="/tmp/e2e_4_litter_urgent.png", full_page=True)
    pg.get_by_role("button", name="Save", exact=True).click()
    pg.get_by_text("2 clumps").wait_for()
    # medications: add one, log a given dose and a missed dose
    pg.get_by_role("tab", name="Meds").click()
    pg.get_by_role("button", name="+ Add a medication").click()
    pg.get_by_label("Name", exact=True).fill("Gabapentin"); pg.get_by_label("Dose, exactly as prescribed").fill("50 mg by mouth")
    pg.get_by_label("How often (optional)").fill("twice a day")
    pg.get_by_role("button", name="Add medication").click()
    pg.get_by_text("What happened?").wait_for()
    pg.get_by_role("button", name="Save", exact=True).click()
    pg.get_by_text("Given · Gabapentin (50 mg by mouth)").wait_for()
    pg.get_by_role("list", name="Medications").get_by_role("button", name="Gabapentin").click()
    pg.get_by_role("button", name="Missed").click(); pg.wait_for_timeout(300)
    assert len(DB["medication_logs"]) == 1, "status chip must not submit"
    pg.get_by_role("button", name="Save", exact=True).click()
    pg.get_by_text("Missed · Gabapentin (50 mg by mouth)").wait_for()
    pg.screenshot(path="/tmp/e2e_meds.png", full_page=True)
    pg.get_by_role("link", name="Home").click()
    pg.get_by_text("42 kcal left of 200").wait_for()
    pg.screenshot(path="/tmp/e2e_5_home.png", full_page=True)
    pg.get_by_role("link", name="Trends").click(); pg.get_by_text("Dashed slots").wait_for()
    pg.reload(); pg.get_by_text("Dashed slots").wait_for()      # BUG4: refresh must stay on the same page
    assert pg.url.endswith("/trends"), "BUG4: refresh jumped to " + pg.url
    pg.screenshot(path="/tmp/e2e_6_trends.png", full_page=True)
    pg.get_by_role("link", name="Health").click()
    pg.get_by_role("button", name="+ Add visit").click()
    pg.get_by_label("Reason for visit").fill("Annual check-up"); pg.get_by_label("What the vet said").fill("Healthy, slightly overweight")
    pg.get_by_role("button", name="Save visit").click(); pg.get_by_text("Annual check-up").wait_for()
    # limits: no new data → Create disabled with a reason; then allowed
    QUOTA.update(used=1, has_new_data=False); pg.reload()
    pg.get_by_text("nothing new logged since your last review").wait_for()
    assert pg.get_by_role("button", name="Create").is_disabled(), "Create must be disabled with no new data"
    QUOTA.update(used=3, has_new_data=True, next_available_at="2026-11-24T00:27:39Z"); pg.reload()
    pg.get_by_text("3 of 3 used in the last 7 days").wait_for()
    assert pg.get_by_role("button", name="Create").is_disabled(), "Create must be disabled at 3/3"
    QUOTA.update(used=1, has_new_data=True, next_available_at=None); pg.reload()
    pg.get_by_text("1 of 3 used in the last 7 days").wait_for()
    pg.get_by_role("button", name="Create").click()
    pg.get_by_text("Email draft to your vet").wait_for()
    pg.screenshot(path="/tmp/e2e_7_report.png", full_page=True)
    pg.get_by_text("Food: logged on 1 of 7 days").first.wait_for(); pg.get_by_text("average 158 kcal per logged day").first.wait_for()   # BUG3: today's 42.5 kcal is included
    pg.get_by_text("Water: logged on 1 of 7 days").first.wait_for()
    pg.get_by_text("doses logged this week: 1 given, 1 missed").first.wait_for()
    pg.get_by_text("One dose of Gabapentin was missed").first.wait_for()
    pg.get_by_text("Template · AI not set up").wait_for()          # P0-2: honest AI label
    # P0-1 UI: a stale review shows a banner, can't be approved, and must be re-created
    DB["care_reports"][0]["status"] = "stale"; pg.reload()
    pg.get_by_text("Your records changed after this review was made.").wait_for()
    assert pg.get_by_role("button", name="I checked it, approve").count() == 0, "stale review must not be approvable"
    pg.get_by_role("button", name="Create it again").click()
    pg.get_by_role("button", name="I checked it, approve").wait_for()
    assert DB["care_reports"][0]["status"] == "needs_review"
    pg.get_by_role("button", name="I checked it, approve").click(); pg.get_by_text("✓ Approved").first.wait_for()
    pg.get_by_label("Vet email draft").fill("edited"); pg.get_by_role("button", name="Save edits").click()
    pg.get_by_text("Needs review").first.wait_for()
    print("report rows:", [(r["status"], r["is_mock"]) for r in DB["care_reports"]])
    pg.once("dialog", lambda d: d.accept())
    pg.get_by_role("button", name="Delete this review").click()
    pg.get_by_role("button", name="Create").wait_for()
    assert len(DB["care_reports"]) == 0, "BUG3: review not deleted"
    print("delete review: ok")
    b.close()
print("PAGE ERRORS:", errors or "none")
print("feeding:", [(r["kcal"], r.get("amount"), r.get("amount_unit"), r["food_name_snapshot"]) for r in DB["feeding_logs"]])
print("foods:", [(f["name"], f["kcal_per_kg"], f["kcal_per_cup"], f["kcal_per_unit"], f["unit_name"]) for f in DB["foods"]])
print("litter:", [(r["urine_count"], r["symptoms"]) for r in DB["litter_logs"]])
print("meds:", [(r["status"], r["med_name_snapshot"], r["dose_snapshot"]) for r in DB["medication_logs"]])
