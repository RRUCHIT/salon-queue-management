import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import type { AdminSnapshot, Barber, DisplaySnapshot, HomeSummary, Language, QueueStatusView, Service, StaffOverview } from "../../shared/types";
import { languageLabels } from "./i18n";

const apiUrl = import.meta.env.VITE_API_URL || "/api";
const socketUrl = apiUrl === "/api" ? window.location.origin : apiUrl.replace(/\/api\/?$/, "");
const socketClient = () => io(socketUrl, { transports: ["websocket", "polling"] });

function message(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template);
}

function Home({ language }: { language: Language }) {
  const labels = languageLabels[language];
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try {
      const response = await fetch(`${apiUrl}/home`);
      if (!response.ok) throw new Error();
      setSummary(await response.json());
      setError(false);
    } catch { setError(true); } finally { setLoading(false); }
  };
  useEffect(() => {
    void load();
    const socket = socketClient();
    socket.on("queue:update", () => void load());
    const timer = window.setInterval(() => void load(), 15000);
    return () => { socket.disconnect(); window.clearInterval(timer); };
  }, []);
  if (loading && !summary) return <main className="min-h-screen px-4 pt-20"><p className="mx-auto max-w-3xl rounded-card bg-white p-6">{labels.loading}</p></main>;
  if (error) return <main className="min-h-screen px-4 pt-20"><div className="mx-auto max-w-3xl rounded-card border border-red-200 bg-white p-6"><p className="text-red-700">{labels.error}</p><button onClick={() => void load()} className="mt-4 rounded-full bg-charcoal px-5 text-white">{labels.retry}</button></div></main>;
  if (!summary) return null;
  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-20 text-charcoal">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-end justify-between"><h1 className="text-3xl font-bold">{labels.homeTitle}</h1><span className={`rounded-full px-4 py-2 text-sm font-bold ${summary.isOpen ? "bg-emerald-50 text-emerald-700" : "bg-slate-200"}`}>{summary.isOpen ? labels.open : labels.closed}</span></div>
        <section className="rounded-card border border-slate-200 bg-white p-6"><p className="text-2xl font-bold">{summary.waitingCount === 0 ? labels.noWaiting : message(labels.waitingLive, { count: summary.waitingCount })}</p>{summary.waitingCount > 0 && <p className="mt-2 text-slate-600">{summary.estimatedWaitMinutes === null ? labels.unavailableWait : message(labels.estimatedWait, { minutes: summary.estimatedWaitMinutes })}</p>}</section>
        <section className="flex flex-wrap gap-3">{summary.barbers.map((barber) => <span key={barber.id} className={`rounded-full border px-4 py-2 text-sm font-semibold ${barber.status === "busy" ? "border-gold bg-amber-50" : barber.status === "break" ? "border-slate-300 bg-slate-100" : "border-emerald-200 bg-emerald-50"}`}>{barber.name} · {barber.status === "busy" ? labels.barberBusy : barber.status === "break" ? labels.barberBreak : labels.barberFree}</span>)}</section>
        {!summary.joinEnabled && <p className="rounded-card border border-amber-200 bg-amber-50 p-4 text-amber-900">{summary.joinMessage === "closingSoon" ? labels.closingSoonMessage : labels.closedMessage}</p>}
        {summary.joinEnabled ? <Link to="/join" className="flex min-h-14 items-center justify-center rounded-full bg-gold px-6 text-lg font-bold text-charcoal no-underline">{labels.joinQueue}</Link> : <button disabled className="min-h-14 w-full rounded-full bg-slate-300 font-bold text-slate-600">{labels.joinQueue}</button>}
      </div>
    </main>
  );
}

function JoinQueue({ language }: { language: Language }) {
  const labels = languageLabels[language];
  const navigate = useNavigate();
  const [services, setServices] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [preferred, setPreferred] = useState("");
  const [preview, setPreview] = useState<{ totalMinutes: number; totalPrice: number; expectedWaitMinutes: number | null } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([fetch(`${apiUrl}/services`).then((r) => r.json()), fetch(`${apiUrl}/barbers`).then((r) => r.json()), fetch(`${apiUrl}/home`).then((r) => r.json())])
      .then(([s, b, h]) => { setServices(s); setBarbers(b); setSummary(h); }).catch(() => setError(labels.joinError));
  }, []);
  useEffect(() => {
    const socket = socketClient();
    socket.on("queue:update", () => {
      Promise.all([
        fetch(`${apiUrl}/services`).then((response) => response.json()),
        fetch(`${apiUrl}/barbers`).then((response) => response.json()),
        fetch(`${apiUrl}/home`).then((response) => response.json()),
      ]).then(([serviceRows, barberRows, home]) => {
        setServices(serviceRows);
        setBarbers(barberRows);
        setSummary(home);
        setError("");
      }).catch(() => setError(labels.joinError));
    });
    return () => { socket.disconnect(); };
  }, []);
  useEffect(() => {
    if (!selected.length) { setPreview(null); return; }
    const timer = window.setTimeout(async () => {
      const response = await fetch(`${apiUrl}/join/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceIds: selected, preferredBarberId: preferred || null }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error); setPreview(null); } else { setPreview(data); setError(""); }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [selected, preferred]);
  const submit = async () => {
    if (!name.trim()) return setError(labels.nameRequired);
    if (!/^\d{10}$/.test(phone.replace(/\D/g, ""))) return setError(labels.phoneRequired);
    if (!selected.length) return setError(labels.serviceRequired);
    try {
      const response = await fetch(`${apiUrl}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone, serviceIds: selected, preferredBarberId: preferred || null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      navigate(`/status/${data.id}`);
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : labels.joinError); }
  };
  const chosenBreak = barbers.find((barber) => String(barber.id) === preferred)?.onBreak;
  const disabled = !summary?.joinEnabled || !!chosenBreak;
  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-28 pt-20 text-charcoal">
      <div className="mx-auto max-w-5xl">
        <button onClick={() => navigate(-1)} className="mb-4 rounded-full border border-slate-300 bg-white px-5">{labels.back}</button>
        <div className="grid gap-5 md:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <section className="rounded-card border border-slate-200 bg-white p-5"><label className="block"><span className="mb-2 block font-bold">{labels.name}</span><input value={name} onChange={(e) => setName(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 px-4" /></label><label className="mt-4 block"><span className="mb-2 block font-bold">{labels.phone}</span><input inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 px-4" /></label></section>
            <section className="rounded-card border border-slate-200 bg-white p-5"><h2 className="mb-3 font-bold">{labels.selectServices}</h2>{services.filter((s) => s.enabled).length === 0 ? <p>{labels.noServices}</p> : <div className="grid gap-3 sm:grid-cols-2">{services.filter((s) => s.enabled).map((service) => { const active = selected.includes(service.id); return <button type="button" key={service.id} onClick={() => setSelected((current) => active ? current.filter((id) => id !== service.id) : current.length < 3 ? [...current, service.id] : current)} className={`min-h-20 rounded-xl border p-4 text-left ${active ? "border-gold bg-amber-50" : "border-slate-200"}`}><span className="block font-bold">{language === "gu" ? service.nameGu : service.nameEn}</span><span className="text-sm text-slate-600">{service.minutes} {labels.minuteUnit} · ₹{service.price}</span></button>; })}</div>}</section>
            <section className="rounded-card border border-slate-200 bg-white p-5"><h2 className="mb-3 font-bold">{labels.chooseBarber}</h2><select value={preferred} onChange={(e) => setPreferred(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 px-4"><option value="">{labels.anyBarber}</option>{barbers.filter((b) => b.onDuty).map((barber) => <option key={barber.id} value={barber.id} disabled={barber.onBreak}>{barber.name}{barber.onBreak ? ` - ${labels.barberBreak}` : ""}</option>)}</select></section>
          </div>
          <aside className="h-fit rounded-card border border-gold/30 bg-white p-5 md:sticky md:top-20"><h2 className="font-bold">{labels.liveSummary}</h2>{preview ? <div className="mt-4 space-y-2"><p>{message(labels.totalTime, { minutes: preview.totalMinutes })}</p><p className="font-bold">{message(labels.totalPrice, { price: preview.totalPrice })}</p>{preview.expectedWaitMinutes !== null && <p>{message(labels.expectedWait, { minutes: preview.expectedWaitMinutes })}</p>}</div> : <p className="mt-4 text-slate-500">{labels.serviceRequired}</p>}{summary && !summary.joinEnabled && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">{summary.joinMessage === "closingSoon" ? labels.closingSoonMessage : labels.unavailableClosed}</p>} {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}</aside>
          <div className="fixed bottom-0 left-0 right-0 z-10 border-t bg-white p-3 md:static md:col-span-2 md:border-0 md:bg-transparent"><button onClick={() => void submit()} disabled={disabled} className="min-h-14 w-full rounded-full bg-gold px-6 text-lg font-bold text-charcoal disabled:bg-slate-300">{labels.confirm}</button></div>
        </div>
      </div>
    </main>
  );
}

function StatusPage({ language }: { language: Language }) {
  const labels = languageLabels[language];
  const { id } = useParams();
  const [status, setStatus] = useState<QueueStatusView | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const load = async () => {
    try { const response = await fetch(`${apiUrl}/status/${id}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); setStatus(data); setCountdown(data.waitMinutes); setError(""); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : labels.error); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); const socket = socketClient(); socket.on("queue:update", () => void load()); const timer = window.setInterval(() => void load(), 15000); return () => { socket.disconnect(); window.clearInterval(timer); }; }, [id]);
  useEffect(() => { if (countdown === null) return; const timer = window.setInterval(() => setCountdown((v) => v === null ? null : Math.max(0, v - 1)), 60000); return () => window.clearInterval(timer); }, [countdown === null]);
  useEffect(() => { if (status?.status === "Called" && "vibrate" in navigator) navigator.vibrate([200,100,200]); }, [status?.status]);
  const cancel = async () => {
    if (!window.confirm(labels.cancelConfirm)) return;
    const response = await fetch(`${apiUrl}/status/${id}/cancel`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error); return; }
    setStatus(data); setCancelled(true);
  };
  if (loading) return <main className="min-h-screen px-4 pt-20"><p className="mx-auto max-w-lg rounded-card bg-white p-6">{labels.loading}</p></main>;
  if (error || !status) return <main className="min-h-screen px-4 pt-20"><div className="mx-auto max-w-lg rounded-card bg-white p-8 text-center"><h1 className="text-2xl font-bold">{labels.resolvedTitle}</h1><Link to="/" className="mt-6 inline-flex min-h-12 items-center rounded-full bg-gold px-6 font-bold text-charcoal no-underline">{labels.backHome}</Link></div></main>;
  if (cancelled || ["Cancelled","Done","No-show"].includes(status.status)) return <main className="min-h-screen px-4 pt-20"><div className="mx-auto max-w-lg rounded-card bg-white p-8 text-center"><h1 className="text-2xl font-bold">{cancelled ? labels.cancelledTitle : labels.resolvedTitle}</h1><p className="mt-3">{status.token}</p><Link to="/" className="mt-6 inline-flex min-h-12 items-center rounded-full bg-gold px-6 font-bold text-charcoal no-underline">{labels.backHome}</Link></div></main>;
  if (status.status === "Called") {
    const barberName = status.assignedBarberName || status.preferredBarberName;
    return (
      <main className="flex min-h-screen animate-pulse items-center justify-center bg-gold px-6 text-center">
        <div>
          <p className="text-2xl font-bold">{status.token}</p>
          <h1 className="text-5xl font-black">{labels.turnAlert}</h1>
          {barberName && (
            <p className="mt-5 text-2xl font-bold">
              {message(labels.goToBarber, { barber: barberName })}
            </p>
          )}
        </div>
      </main>
    );
  }
  if (status.status === "In chair") {
    const barberName = status.assignedBarberName || status.preferredBarberName;
    return (
      <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-20 text-charcoal">
        <div className="mx-auto max-w-lg rounded-card border border-slate-200 bg-white p-6 text-center">
          <span className="rounded-full bg-gold px-4 py-2 text-sm font-bold">{labels.inChairStatus}</span>
          <p className="mt-6 text-6xl font-black">{status.token}</p>
          {barberName && <p className="mt-4 text-xl font-bold">{message(labels.yourBarber, { barber: barberName })}</p>}
          <p className="mt-5 rounded-xl border border-gold bg-amber-50 p-4">{labels.inChairMessage}</p>
          <Link to="/" className="mt-6 inline-flex min-h-12 items-center rounded-full border-2 border-gold px-6 font-bold text-charcoal no-underline">{labels.backHome}</Link>
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-20 text-charcoal">
      <div className="mx-auto max-w-lg rounded-card border border-slate-200 bg-white p-6 text-center">
        <div className="flex justify-between">
          <b>{labels.appName}</b>
          <span className="rounded-full bg-emerald-50 px-3 py-2 text-emerald-700">{labels.liveSync}</span>
        </div>
        <span className="mt-5 inline-block rounded-full border border-slate-300 px-4 py-2 text-sm font-bold">{labels.waitingStatus}</span>
        <p className="mt-5 text-6xl font-black">{status.token}</p>
        {status.position && <p className="mt-3 text-xl font-bold">{message(labels.position, { position: status.position })}</p>}
        <div className="mx-auto mt-6 flex h-44 w-44 items-center justify-center rounded-full border-[10px] border-gold">
          <div><p className="text-4xl font-black">{countdown ?? 0}</p><p>{labels.minuteUnit}</p></div>
        </div>
        {status.position === 2 && <p className="mt-4 rounded-xl bg-amber-50 p-4 font-bold">{labels.secondPosition}</p>}
        <p className="mt-4 text-sm text-slate-600">{labels.waitingStatusMessage}</p>
        {status.status === "Waiting" && (
          <button onClick={() => void cancel()} className="mt-6 min-h-14 w-full rounded-full border-2 border-gold font-bold">{labels.cancelSpot}</button>
        )}
      </div>
    </main>
  );
}

function StaffPinGate({ language, children }: { language: Language; children: (pin: string) => React.ReactNode }) {
  const labels = languageLabels[language];
  const [pin, setPin] = useState(() => window.sessionStorage.getItem("salon-staff-pin") || "");
  const [entered, setEntered] = useState("");
  const [error, setError] = useState("");
  const unlock = async () => {
    const response = await fetch(`${apiUrl}/staff/overview`, { headers: { "x-staff-pin": entered } });
    if (!response.ok) { setError(labels.enteredPinInvalid); return; }
    window.sessionStorage.setItem("salon-staff-pin", entered); setPin(entered);
  };
  if (pin) return <>{children(pin)}</>;
  return <main className="min-h-screen px-4 pt-24"><div className="mx-auto max-w-md rounded-card border border-slate-200 bg-white p-6"><h1 className="text-2xl font-bold">{labels.staffPin}</h1><input type="password" value={entered} onChange={(e) => setEntered(e.target.value)} className="mt-4 min-h-12 w-full rounded-xl border border-slate-300 px-4" /><button onClick={() => void unlock()} className="mt-4 min-h-12 w-full rounded-full bg-gold font-bold">{labels.unlock}</button>{error && <p className="mt-3 text-red-700">{error}</p>}</div></main>;
}

function ReceptionWorkspace({ pin, language }: { pin: string; language: Language }) {
  const labels = languageLabels[language];
  const [overview, setOverview] = useState<StaffOverview | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [preferred, setPreferred] = useState("");
  const [error, setError] = useState("");
  const headers = { "Content-Type": "application/json", "x-staff-pin": pin };
  const load = async () => {
    try {
      const [staff, serviceRows, barberRows] = await Promise.all([fetch(`${apiUrl}/staff/overview`, { headers: { "x-staff-pin": pin } }), fetch(`${apiUrl}/services`), fetch(`${apiUrl}/barbers`)]);
      if (!staff.ok) throw new Error(labels.enteredPinInvalid);
      setOverview(await staff.json()); setServices(await serviceRows.json()); setBarbers(await barberRows.json()); setError("");
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : labels.error); }
  };
  useEffect(() => { void load(); const socket = socketClient(); socket.on("queue:update", () => void load()); return () => { socket.disconnect(); }; }, [pin]);
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`${apiUrl}${path}`, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || labels.error); return data;
  };
  const addWalkIn = async () => {
    if (!name.trim()) return setError(labels.nameRequired);
    if (!/^\d{10}$/.test(phone.replace(/\D/g, ""))) return setError(labels.phoneRequired);
    if (!selected.length) return setError(labels.serviceRequired);
    try { await request("/staff/walk-in", { name, phone, serviceIds: selected, preferredBarberId: preferred || null }); setShow(false); setName(""); setPhone(""); setSelected([]); setPreferred(""); } catch (addError) { setError(addError instanceof Error ? addError.message : labels.error); }
  };
  return <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-20"><div className="mx-auto max-w-[1180px]"><div className="flex items-center justify-between"><h1 className="text-2xl font-bold">{labels.reception}</h1><button onClick={() => setShow(true)} className="min-h-12 rounded-full bg-gold px-5 font-bold">+ {labels.addWalkIn}</button></div>
  {show && <section className="mt-4 rounded-card border border-gold/40 bg-white p-5"><div className="grid gap-3 md:grid-cols-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={labels.name} className="min-h-12 rounded-xl border px-4" /><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder={labels.phone} className="min-h-12 rounded-xl border px-4" /></div><div className="mt-3 flex flex-wrap gap-2">{services.filter((s) => s.enabled).map((s) => <button key={s.id} onClick={() => setSelected((c) => c.includes(s.id) ? c.filter((id) => id !== s.id) : c.length < 3 ? [...c, s.id] : c)} className={`min-h-12 rounded-full border px-4 ${selected.includes(s.id) ? "border-gold bg-amber-50" : "border-slate-300"}`}>{language === "gu" ? s.nameGu : s.nameEn}</button>)}</div><select value={preferred} onChange={(e) => setPreferred(e.target.value)} className="mt-3 min-h-12 w-full rounded-xl border px-4"><option value="">{labels.anyBarber}</option>{barbers.filter((b) => b.onDuty).map((b) => <option key={b.id} value={b.id} disabled={b.onBreak}>{b.name}</option>)}</select><div className="mt-4 flex gap-3"><button onClick={() => void addWalkIn()} className="min-h-12 rounded-full bg-gold px-6 font-bold">{labels.add}</button><button onClick={() => setShow(false)} className="min-h-12 rounded-full border px-6">{labels.cancel}</button></div></section>}
  {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
  {overview && <><section className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">{overview.barbers.map((barber) => { const calledEntry = overview.called.find((entry) => entry.barberId === barber.id); const displayCustomer = barber.currentCustomer || calledEntry?.name; const displayToken = barber.currentToken || calledEntry?.token; const elapsed = barber.startedAt ? (Date.now() - new Date(barber.startedAt).getTime()) / 60000 : 0; const progress = barber.currentMinutes ? Math.min(100, elapsed / barber.currentMinutes * 100) : 0; return <article key={barber.id} className="rounded-card border border-slate-200 bg-white p-4"><div className="flex justify-between"><h2 className="font-bold">{barber.name}</h2><span className="text-sm">{barber.onBreak ? labels.onBreak : displayCustomer ? labels.barberBusy : labels.available}</span></div><p className="mt-3 text-slate-600">{displayCustomer || labels.noCustomerInChair}</p>{displayToken && <b>{displayToken}</b>}{barber.startedAt && <><p className="mt-2 text-xs">{labels.timeLeft}: {Math.max(0, Math.ceil(barber.currentMinutes - elapsed))} {labels.minuteUnit}</p><div className="mt-2 h-2 rounded-full bg-slate-200"><div className="h-full rounded-full bg-gold" style={{ width: `${progress}%` }} /></div></>}<button disabled={barber.onBreak || !barber.onDuty || !!displayCustomer} onClick={() => void request(`/staff/barbers/${barber.id}/call`).catch((callError) => setError(callError.message))} className="mt-4 min-h-12 w-full rounded-full bg-gold font-bold disabled:bg-slate-300">{labels.callNext}</button></article>; })}</section>
  <section className="mt-5 rounded-card border border-slate-200 bg-white p-4"><h2 className="text-lg font-bold">{labels.waitingList}</h2>{overview.waiting.length === 0 ? <p className="py-8 text-center text-slate-600">{labels.noOneWaiting}</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b"><th className="py-3">{labels.token}</th><th>{labels.name}</th><th>{labels.services}</th><th>{labels.preferred}</th><th>{labels.waitingTime}</th><th>{labels.actions}</th></tr></thead><tbody>{overview.waiting.map((entry) => { const waited = (Date.now() - new Date(entry.joinedAt).getTime()) / 60000; return <tr key={entry.id} className={waited > 60 ? "bg-amber-50" : "border-b"}><td className="py-3 font-bold">{entry.token}</td><td>{entry.name}</td><td>{entry.services.map((s) => language === "gu" ? s.nameGu : s.nameEn).join(", ")}</td><td>{entry.preferredBarberName || labels.anyBarber}</td><td>{Math.floor(waited)} {labels.minuteUnit}</td><td><button onClick={() => void request(`/staff/entries/${entry.id}/cancel`).catch((cancelError) => setError(cancelError.message))} className="min-h-11 rounded-full border px-3">{labels.cancel}</button></td></tr>; })}</tbody></table></div>}</section>
  {overview.called.length > 0 && <section className="mt-5 rounded-card border border-slate-200 bg-white p-4"><h2 className="font-bold">{labels.noShow}</h2>{overview.called.map((entry) => <div key={entry.id} className="mt-3 flex justify-between rounded-lg border p-3"><span>{entry.token} · {entry.name} · {entry.barberName}</span><button onClick={() => { if (window.confirm(labels.confirmNoShow)) void request(`/staff/entries/${entry.id}/no-show`, { confirmedTenMinutes: true }).catch((noShowError) => setError(noShowError.message)); }} className="min-h-11 rounded-full border border-amber-500 px-4">{labels.noShow}</button></div>)}</section>}</>}</div></main>;
}

function Reception({ language }: { language: Language }) {
  return <StaffPinGate language={language}>{(pin) => <ReceptionWorkspace pin={pin} language={language} />}</StaffPinGate>;
}

function BarberWorkspace({ pin, language, routeName }: { pin: string; language: Language; routeName: string }) {
  const labels = languageLabels[language];
  const [overview, setOverview] = useState<StaffOverview | null>(null);
  const [error, setError] = useState("");
  const routeBarberName = decodeURIComponent(routeName);
  const barber = overview?.barbers.find((b) => b.name.toLowerCase() === routeBarberName.toLowerCase());
  const headers = { "Content-Type": "application/json", "x-staff-pin": pin };
  const load = async () => {
    const response = await fetch(`${apiUrl}/staff/overview`, { headers: { "x-staff-pin": pin } });
    if (!response.ok) throw new Error(labels.enteredPinInvalid);
    setOverview(await response.json());
  };
  useEffect(() => { void load().catch((loadError) => setError(loadError.message)); const socket = socketClient(); socket.on("queue:update", () => void load().catch((loadError) => setError(loadError.message))); return () => { socket.disconnect(); }; }, [pin]);
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`${apiUrl}${path}`, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || labels.error); return data;
  };
  if (!barber) return <main className="min-h-screen px-4 pt-24"><p className="rounded-card bg-white p-6">{labels.error}</p></main>;
  const calledEntry = overview?.called.find((entry) => entry.barberId === barber.id);
  const next = overview?.waiting.find((entry) => entry.preferredBarberId === barber.id || entry.preferredBarberId === null);
  return <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-20"><div className="mx-auto max-w-lg space-y-5"><section className="rounded-card border bg-white p-5"><div className="flex justify-between"><h1 className="text-2xl font-bold">{barber.name}</h1><button onClick={() => void request(`/staff/barbers/${barber.id}/availability`, { onBreak: !barber.onBreak }).catch((breakError) => setError(breakError.message))} className="min-h-12 rounded-full bg-gold px-4 font-bold">{barber.onBreak ? labels.available : labels.onBreak}</button></div></section>{error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}<section className="rounded-card border border-gold/40 bg-white p-5 text-center">{barber.currentCustomer ? <><p>{labels.currentCustomer}</p><p className="mt-2 text-4xl font-black">{barber.currentToken}</p><p className="mt-2 text-xl">{barber.currentCustomer}</p>{barber.startedAt && <LiveTimer startedAt={barber.startedAt} />}<button onClick={() => void request(`/staff/barbers/${barber.id}/done/${barber.currentEntryId}`).catch((doneError) => setError(doneError.message))} className="mt-5 min-h-14 w-full rounded-full bg-gold text-lg font-bold">{labels.done}</button></> : <><p className="text-lg font-bold">{labels.noCustomerInChair}</p>{calledEntry && <button onClick={() => void request(`/staff/barbers/${barber.id}/start/${calledEntry.id}`).catch((startError) => setError(startError.message))} className="mt-5 min-h-14 w-full rounded-full bg-gold text-lg font-bold">{labels.start}</button>}</>}</section><section className="rounded-card border bg-white p-5"><h2 className="font-bold">{labels.nextForYou}</h2><p className="mt-3 text-slate-600">{next ? next.token : labels.noNextCustomer}</p></section></div></main>;
}

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { const update = () => setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)); update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer); }, [startedAt]);
  return <p className="mt-3 text-3xl font-black tabular-nums">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</p>;
}

function BarberView({ language, name }: { language: Language; name: string }) {
  return <StaffPinGate language={language}>{(pin) => <BarberWorkspace pin={pin} language={language} routeName={name} />}</StaffPinGate>;
}

function DisplayScreen({ language }: { language: Language }) {
  const labels = languageLabels[language];
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [flashToken, setFlashToken] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioContext = { current: null as AudioContext | null };

  const loadDisplay = async () => {
    try {
      const response = await fetch(`${apiUrl}/display`);
      if (!response.ok) throw new Error();
      setSnapshot(await response.json());
    } catch {
      setReconnecting(true);
    }
  };

  useEffect(() => {
    void loadDisplay();
    const socket = socketClient();
    socket.on("connect", () => {
      setReconnecting(false);
      void loadDisplay();
    });
    socket.on("disconnect", () => setReconnecting(true));
    socket.on("reconnect", () => setReconnecting(false));
    socket.on("queue:update", () => void loadDisplay());
    socket.on("queue:called", (called: { token: string }) => {
      setFlashToken(called.token);
      window.setTimeout(() => setFlashToken(null), 5000);
      if (soundEnabled && audioContext.current) {
        const context = audioContext.current;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 880;
        gain.gain.value = 0.12;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.35);
      }
    });
    return () => { socket.disconnect(); };
  }, [soundEnabled]);

  const enableSound = async () => {
    const context = new AudioContext();
    await context.resume();
    audioContext.current = context;
    setSoundEnabled(true);
  };

  return (
    <main className="relative flex h-screen overflow-hidden bg-[#1F2937] text-white">
      {!soundEnabled && (
        <button type="button" onClick={() => void enableSound()}
          className="absolute right-8 top-6 z-20 min-h-12 rounded-full bg-gold px-6 font-bold text-[#1F2937]">
          {labels.enableSound}
        </button>
      )}
      {flashToken && (
        <div className="absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-3xl border-4 border-gold bg-gold px-12 py-5 text-5xl font-black text-[#1F2937] shadow-2xl">
          {flashToken}
        </div>
      )}
      {reconnecting && (
        <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-amber-500 px-5 py-2 font-bold text-[#1F2937]">
          {labels.reconnecting}
        </div>
      )}
      <section className="flex w-[68%] flex-col gap-4 p-8 pr-4">
        <h1 className="text-5xl font-black text-gold">{labels.appName}</h1>
        <div className="flex flex-1 flex-col gap-4">
          {snapshot?.barbers.map((barber) => (
            <article key={barber.id}
              className={`flex min-h-[150px] items-center rounded-3xl border-2 px-8 transition-colors ${
                flashToken && snapshot.upNext.some((entry) => entry.token === flashToken)
                  ? "border-gold bg-gold text-[#1F2937]"
                  : "border-slate-600 bg-slate-800"
              }`}>
              {barber.photoUrl
                ? <img src={barber.photoUrl} alt="" className="h-28 w-28 rounded-full object-cover" />
                : <div className="flex h-28 w-28 items-center justify-center rounded-full bg-slate-600 text-5xl font-black">{barber.name.slice(0, 1)}</div>}
              <div className="ml-8">
                <p className="text-4xl font-bold">{barber.name}</p>
                <p className="mt-3 text-3xl">
                  {barber.currentToken ? `${labels.now}: ${barber.currentToken}` : labels.noCustomersInChair}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <aside className="flex w-[32%] flex-col border-l-2 border-slate-600 p-8">
        <h2 className="text-4xl font-black text-gold">{labels.upNext}</h2>
        {snapshot?.upNext.length === 0 ? (
          <p className="mt-12 text-3xl text-slate-300">{labels.queueEmpty}</p>
        ) : (
          <div className="mt-8 space-y-4">
            {snapshot?.upNext.map((entry) => (
              <div key={entry.token}
                className={`flex items-center justify-between rounded-2xl border-2 px-6 py-5 text-3xl ${
                  flashToken === entry.token ? "border-gold bg-gold text-[#1F2937]" : "border-slate-600 bg-slate-800"
                }`}>
                <b>{entry.token}</b>
                <span>{entry.estimatedMinutes === null ? "--" : `${entry.estimatedMinutes} ${labels.minuteUnit}`}</span>
              </div>
            ))}
          </div>
        )}
      </aside>
    </main>
  );
}

function AdminWorkspace({ pin, language }: { pin: string; language: Language }) {
  const labels = languageLabels[language];
  const [admin, setAdmin] = useState<AdminSnapshot | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ nameEn: "", nameGu: "", minutes: "30", price: "100", enabled: true });
  const headers = { "Content-Type": "application/json", "x-staff-pin": pin };

  const loadAdmin = async () => {
    const response = await fetch(`${apiUrl}/staff/admin`, { headers: { "x-staff-pin": pin } });
    if (!response.ok) throw new Error(labels.enteredPinInvalid);
    setAdmin(await response.json());
  };

  useEffect(() => {
    void loadAdmin().catch((loadError) => setError(loadError.message));
    const socket = socketClient();
    socket.on("queue:update", () => void loadAdmin().catch((loadError) => setError(loadError.message)));
    return () => { socket.disconnect(); };
  }, [pin]);

  const request = async (path: string, method: "POST" | "PUT" | "PATCH", body: unknown) => {
    const response = await fetch(`${apiUrl}${path}`, { method, headers, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || labels.error);
    await loadAdmin();
  };

  const createService = async () => {
    try {
      await request("/staff/services", "POST", {
        nameEn: draft.nameEn,
        nameGu: draft.nameGu,
        minutes: Number(draft.minutes),
        price: Number(draft.price),
        enabled: draft.enabled,
      });
      setDraft({ nameEn: "", nameGu: "", minutes: "30", price: "100", enabled: true });
      setError("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : labels.error);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-20 text-charcoal">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold">{labels.admin}</h1>
        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-700" role="alert">{error}</p>}
        {admin && (
          <>
            <section className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <article className="rounded-card border border-slate-200 bg-white p-5"><p className="text-slate-500">{labels.servedToday}</p><p className="mt-2 text-4xl font-black">{admin.stats.served}</p></article>
              <article className="rounded-card border border-slate-200 bg-white p-5"><p className="text-slate-500">{labels.averageWait}</p><p className="mt-2 text-4xl font-black">{admin.stats.averageWait} {labels.minuteUnit}</p></article>
              <article className="rounded-card border border-slate-200 bg-white p-5"><p className="text-slate-500">{labels.noShowsToday}</p><p className="mt-2 text-4xl font-black">{admin.stats.noShows}</p></article>
            </section>

            <section className="mt-5 rounded-card border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">{labels.onlineJoining}</h2>
                <button type="button"
                  onClick={() => void request("/staff/settings/open", "PATCH", { isOpen: !admin.isOpen }).catch((openError) => setError(openError.message))}
                  className={`min-h-12 rounded-full px-6 font-bold ${admin.isOpen ? "bg-gold text-charcoal" : "border border-slate-300 bg-white"}`}>
                  {admin.isOpen ? labels.open : labels.closed}
                </button>
              </div>
            </section>

            <section className="mt-5 grid gap-5 md:grid-cols-2">
              <div className="rounded-card border border-slate-200 bg-white p-5">
                <h2 className="text-xl font-bold">{labels.services}</h2>
                <div className="mt-4 space-y-3">
                  {admin.services.map((service) => (
                    <article key={service.id} className="grid gap-2 rounded-xl border border-slate-200 p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <input aria-label={labels.nameEn} defaultValue={service.nameEn} id={`service-en-${service.id}`} className="min-h-11 rounded-lg border px-3" />
                        <input aria-label={labels.nameGu} defaultValue={service.nameGu} id={`service-gu-${service.id}`} className="min-h-11 rounded-lg border px-3" />
                        <input aria-label={labels.minutes} type="number" defaultValue={service.minutes} id={`service-min-${service.id}`} className="min-h-11 rounded-lg border px-3" />
                        <input aria-label={labels.price} type="number" defaultValue={service.price} id={`service-price-${service.id}`} className="min-h-11 rounded-lg border px-3" />
                      </div>
                      <div className="flex gap-2">
                        <button type="button"
                          onClick={() => {
                            const nameEn = (document.getElementById(`service-en-${service.id}`) as HTMLInputElement).value;
                            const nameGu = (document.getElementById(`service-gu-${service.id}`) as HTMLInputElement).value;
                            const minutes = Number((document.getElementById(`service-min-${service.id}`) as HTMLInputElement).value);
                            const price = Number((document.getElementById(`service-price-${service.id}`) as HTMLInputElement).value);
                            void request(`/staff/services/${service.id}`, "PUT", { nameEn, nameGu, minutes, price, enabled: service.enabled }).catch((saveError) => setError(saveError.message));
                          }}
                          className="min-h-11 rounded-full bg-gold px-4 font-bold">{labels.save}</button>
                        <button type="button"
                          onClick={() => void request(`/staff/services/${service.id}/enabled`, "PATCH", { enabled: !service.enabled }).catch((toggleError) => setError(toggleError.message))}
                          className={`min-h-11 rounded-full border px-4 ${service.enabled ? "border-gold" : "border-slate-300"}`}>
                          {service.enabled ? labels.enabled : labels.closed}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="mt-5 border-t pt-5">
                  <h3 className="font-bold">{labels.createService}</h3>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <input value={draft.nameEn} onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })} placeholder={labels.nameEn} className="min-h-11 rounded-lg border px-3" />
                    <input value={draft.nameGu} onChange={(event) => setDraft({ ...draft, nameGu: event.target.value })} placeholder={labels.nameGu} className="min-h-11 rounded-lg border px-3" />
                    <input value={draft.minutes} type="number" onChange={(event) => setDraft({ ...draft, minutes: event.target.value })} placeholder={labels.minutes} className="min-h-11 rounded-lg border px-3" />
                    <input value={draft.price} type="number" onChange={(event) => setDraft({ ...draft, price: event.target.value })} placeholder={labels.price} className="min-h-11 rounded-lg border px-3" />
                  </div>
                  <button type="button" onClick={() => void createService()} className="mt-3 min-h-12 rounded-full bg-gold px-5 font-bold">{labels.createService}</button>
                </div>
              </div>

              <div className="rounded-card border border-slate-200 bg-white p-5">
                <h2 className="text-xl font-bold">{labels.barber}</h2>
                <div className="mt-4 space-y-3">
                  {admin.barbers.map((barber) => (
                    <div key={barber.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                      <div><p className="font-bold">{barber.name}</p><p className="text-sm text-slate-500">{barber.onBreak ? labels.onBreak : barber.onDuty ? labels.available : labels.offDuty}</p></div>
                      <button type="button"
                        onClick={() => void request(`/staff/barbers/${barber.id}/duty`, "PATCH", { onDuty: !barber.onDuty }).catch((dutyError) => setError(dutyError.message))}
                        className={`min-h-12 rounded-full px-5 font-bold ${barber.onDuty ? "bg-gold" : "border border-slate-300"}`}>
                        {barber.onDuty ? labels.onDuty : labels.offDuty}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function AdminScreen({ language }: { language: Language }) {
  return (
    <StaffPinGate language={language}>
      {(pin) => <AdminWorkspace pin={pin} language={language} />}
    </StaffPinGate>
  );
}

export default function App() {
  const [language, setLanguage] = useState<Language>(() => window.localStorage.getItem("salon-language") === "gu" ? "gu" : "en");
  const labels = languageLabels[language];
  const location = useLocation();
  const toggle = () => { const next = language === "en" ? "gu" : "en"; setLanguage(next); window.localStorage.setItem("salon-language", next); };
  return (
    <div>
      {location.pathname !== "/display" && (
        <header className="fixed right-4 top-4 z-20 flex gap-2">
          <Link to="/" className="rounded-full bg-charcoal px-4 py-2 text-sm font-bold text-white no-underline">{labels.appName}</Link>
          <button onClick={toggle} className="min-h-11 rounded-full border border-gold bg-white px-4">{languageLabels[language === "en" ? "gu" : "en"].language}</button>
        </header>
      )}
      <Routes>
        <Route path="/" element={<Home language={language} />} />
        <Route path="/join" element={<JoinQueue language={language} />} />
        <Route path="/status/:id" element={<StatusPage language={language} />} />
        <Route path="/reception" element={<Reception language={language} />} />
        <Route path="/barber/:name" element={<BarberRoute language={language} />} />
        <Route path="/display" element={<DisplayScreen language={language} />} />
        <Route path="/admin" element={<AdminScreen language={language} />} />
        <Route path="*" element={<main className="min-h-screen px-4 pt-24"><div className="mx-auto max-w-lg rounded-card bg-white p-8 text-center"><h1 className="text-2xl font-bold">{labels.notFound}</h1><Link to="/" className="mt-6 inline-flex min-h-12 items-center rounded-full bg-gold px-6 font-bold text-charcoal no-underline">{labels.backHome}</Link></div></main>} />
      </Routes>
    </div>
  );
}

function BarberRoute({ language }: { language: Language }) {
  const { name = "" } = useParams();
  return <BarberView language={language} name={name} />;
}
