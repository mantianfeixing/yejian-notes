"use strict";

const el = id => document.getElementById(id);
const storagePrefix = "yejian.v1." + location.pathname.replace(/(?:index\.html)?$/, "") + "|";
const noteKey = id => storagePrefix + "note." + id;
const notes = new Map();
const linkedFiles = new Map();
const storedText = new Map();
const unsaved = new Set();
let active = "";
let editing = false;
let savingFile = false;
let storageOK = true;

const guide = {
  title: "写下第一篇笔记",
  body: "这里是你的个人笔记本。点击「新建笔记」，就可以开始记录；也可以打开已有的 Markdown 文件，接着写。\n\n## 在页间写作\n\n- 在「编辑」里写标题和正文，切换到「阅读」查看排版。\n- 用左侧搜索框查找标题或正文，按 / 可以直接开始搜索。\n- 笔记会自动保存在当前浏览器。重要内容可以用「导出 .md」备份。\n\n## 和 Codex 一起改稿\n\n在桌面版 Edge 或 Chrome 中打开本地 Markdown 文件，修改后点击「存回原文件」。把同一份文件交给 Codex，就可以接着编辑。再次打开文件可载入最新版本。",
  id: "welcome", updated: new Date().toISOString()
};
function freshId() {
  return crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function loadNote(raw) {
  const n = JSON.parse(raw);
  if (n && typeof n.id === "string" && typeof n.title === "string" && typeof n.body === "string" && Number.isFinite(Date.parse(n.updated))) return n;
  throw Error("Invalid note");
}
function status(message) { el("status").textContent = message; }
function saveLocal(n) {
  const raw = JSON.stringify(n);
  try {
    // Preserve both versions when another tab has edited this note since it was read.
    const prior = storedText.get(n.id);
    const disk = localStorage.getItem(noteKey(n.id));
    if (prior !== undefined && prior !== disk) {
      const oldId = n.id;
      n = { ...n, id: freshId(), title: (n.title || "无标题笔记") + "（本地副本）" };
      if (disk) { const changed = loadNote(disk); notes.set(oldId, changed); storedText.set(oldId, disk); }
      else { notes.delete(oldId); storedText.delete(oldId); }
      unsaved.delete(oldId);
      notes.set(n.id, n); active = n.id;
      localStorage.setItem(noteKey(n.id), JSON.stringify(n));
      storedText.set(n.id, JSON.stringify(n));
      return "其他标签页已更改原笔记，你的编辑已另存为副本";
    }
    localStorage.setItem(noteKey(n.id), raw);
    storedText.set(n.id, raw); unsaved.delete(n.id); storageOK = true;
    return "已保存到此浏览器";
  } catch {
    storageOK = false; unsaved.add(n.id);
    return "浏览器保存失败，请立即导出 .md 备份";
  }
}
function init() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(noteKey(""))) continue;
      const raw = localStorage.getItem(key);
      try { const n = loadNote(raw); notes.set(n.id,n); storedText.set(n.id,raw); } catch { /* Skip damaged entries and preserve their data. */ }
    }
    if (!notes.size && !localStorage.getItem(storagePrefix + "started")) {
      notes.set(guide.id,guide); saveLocal(guide);
      localStorage.setItem(storagePrefix + "started","1");
    }
  } catch { storageOK = false; if (!notes.size) notes.set(guide.id,guide); }
  active = sorted()[0]?.id || "";
  render();
}
function sorted() { return [...notes.values()].sort((a,b) => b.updated.localeCompare(a.updated)); }
function make(tag, cls, value) {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (value !== undefined) element.textContent = value;
  return element;
}
function displayTitle(n) { return n.title.trim() || "无标题笔记"; }
function dateOf(n, full) {
  return new Date(n.updated).toLocaleDateString("zh-CN", full ? {year:"numeric",month:"long",day:"numeric"} : {month:"short",day:"numeric"});
}
function drawList() {
  const query = el("search").value.trim().toLocaleLowerCase();
  const list = el("list"); list.replaceChildren();
  const visible = sorted().filter(n => (n.title + "\n" + n.body).toLocaleLowerCase().includes(query));
  el("total").textContent = String(notes.size);
  for (const n of visible) {
    const b = make("button","item");
    b.setAttribute("aria-current", String(n.id === active));
    const snippet = n.body.replace(/[#*\n>`]+/g," ").trim().slice(0,24);
    b.append(make("strong","",displayTitle(n)), make("small","", dateOf(n,false) + (snippet ? " · " + snippet : "")));
    b.onclick = () => { active = n.id; editing = false; setShelf(false); render(); };
    list.append(b);
  }
  if (!visible.length) list.append(make("p","muted",query ? "没有找到匹配的笔记" : "笔记本是空的"));
}
// Build the preview as text and DOM elements so Markdown cannot inject HTML.
function inline(parent, text) {
  const pattern = /(\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let offset = 0;
  for (const m of text.matchAll(pattern)) {
    parent.append(text.slice(offset,m.index));
    if (m[2]) parent.append(make("strong","",m[2]));
    else if (m[3]) parent.append(make("code","",m[3]));
    else { const a = make("a","",m[4]); a.href=m[5]; a.target="_blank"; a.rel="noopener noreferrer"; parent.append(a); }
    offset = m.index + m[0].length;
  }
  parent.append(text.slice(offset));
}
function markdown(source) {
  const fragment = document.createDocumentFragment();
  let paragraph = [], code = null, list = null;
  function flush() {
    if (paragraph.length) { const p=make("p"); inline(p,paragraph.join("\n")); fragment.append(p); paragraph=[]; }
    list=null;
  }
  function finishCode() { const pre=make("pre"); pre.append(make("code","",code.join("\n"))); fragment.append(pre); code=null; }
  for (const line of source.replace(/\r\n?/g,"\n").split("\n")) {
    if (/^\s*```/.test(line)) { if (code === null) { flush(); code=[]; } else finishCode(); continue; }
    if (code !== null) { code.push(line); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(line);
    if (!line.trim()) { flush(); continue; }
    if (heading) { flush(); const h=make("h"+Math.max(2, Math.min(6,heading[1].length))); inline(h,heading[2]); fragment.append(h); continue; }
    if (/^>\s?/.test(line)) { flush(); const q=make("blockquote"); inline(q,line.replace(/^>\s?/,"")); fragment.append(q); continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flush(); fragment.append(make("hr")); continue; }
    if (bullet) {
      const type = /^\d/.test(bullet[1]) ? "ol" : "ul";
      if (!list || list.localName !== type) { flush(); list=make(type); fragment.append(list); }
      const li=make("li"); inline(li,bullet[2]); list.append(li); continue;
    }
    list=null; paragraph.push(line);
  }
  if (code !== null) finishCode();
  flush(); return fragment;
}
function metrics(n) {
  el("crumb").textContent = n ? displayTitle(n) : "笔记";
  el("date").textContent = n ? dateOf(n,true) : "";
  el("count").textContent = n ? n.body.replace(/\s/g,"").length + " 字符" : "";
}
function render(message) {
  const n = notes.get(active);
  drawList(); metrics(n);
  el("empty").hidden = !!n;
  el("title").hidden = el("body").hidden = !n || !editing;
  el("article").hidden = el("readTitle").hidden = !n || editing;
  el("writeBack").hidden = !linkedFiles.has(active);
  el("writeBack").disabled = savingFile;
  for (const id of ["edit","read","download","remove"]) el(id).disabled = !n;
  el("read").setAttribute("aria-pressed",String(!editing)); el("edit").setAttribute("aria-pressed",String(editing));
  if (n) {
    el("title").value=n.title; el("body").value=n.body; el("readTitle").textContent=displayTitle(n);
    if (!editing) el("article").replaceChildren(n.body.trim() ? markdown(n.body) : make("p","muted","这篇笔记还是空白，点击「编辑」开始写。"));
  }
  status(message ?? (!storageOK || unsaved.has(active) ? "浏览器存储不可用，请导出备份" : n ? "已保存到此浏览器" : ""));
}
function startNote(title="", body="", mode=true) {
  const n={id:freshId(), title, body, updated:new Date().toISOString()};
  notes.set(n.id,n); active=n.id; editing=mode;
  el("search").value=""; setShelf(false); render(saveLocal(n));
  if (mode) el("title").focus();
  return n;
}
function change() {
  const n=notes.get(active); if (!n) return;
  n.title=el("title").value; n.body=el("body").value; n.updated=new Date().toISOString();
  const message=saveLocal(n);
  if (active!==n.id) { render(message); return; }
  metrics(n); drawList(); status(message);
}
function serialize(n) { return "# " + displayTitle(n) + "\n\n" + n.body; }
function exportNote() {
  const n=notes.get(active); if (!n) return;
  const url=URL.createObjectURL(new Blob([serialize(n)],{type:"text/markdown;charset=utf-8"}));
  const a=make("a"); a.href=url; a.download=(displayTitle(n).replace(/[<>:"/\\|?*\u0000-\u001f]/g,"_").slice(0,110) || "笔记") + ".md";
  document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function importFile(file,handle) {
  const source=await file.text();
  const plain=source.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n");
  const heading=/^# ([^\n]+)(?:\n\n?|\n?$)/.exec(plain);
  const title=heading ? heading[1] : file.name.replace(/\.(markdown|md|txt)$/i,"");
  const body=heading ? plain.slice(heading[0].length) : plain;
  if (handle) {
    for (const [id,link] of linkedFiles) {
      if (!await handle.isSameEntry(link.handle)) continue;
      const prior=notes.get(id);
      if (!prior) continue;
      if (source === link.source || (prior.title === link.title && prior.body === link.body)) {
        let message;
        if (source !== link.source) {
          Object.assign(prior,{title,body,updated:new Date().toISOString()});
          Object.assign(link,{source,title,body,hasHeading:!!heading});
          message=saveLocal(prior);
        }
        active=id; editing=false; el("search").value=""; setShelf(false);
        render(message ?? "已打开本地文件 · " + file.name);
        return;
      }
      // Both the disk file and its draft changed. Keep the old draft as a browser note.
      linkedFiles.delete(id);
      break;
    }
  }
  const n=startNote(title,body,false);
  if (handle) {
    linkedFiles.set(n.id,{handle,source,title,body,hasHeading:!!heading});
    render(storageOK ? "已打开本地文件 · " + file.name : "浏览器保存失败，请导出备份");
  }
}
async function openFile() {
  if (!window.showOpenFilePicker) { el("picker").click(); return; }
  try {
    const [handle]=await window.showOpenFilePicker({types:[{description:"Markdown 或文本文件",accept:{"text/plain":[".md",".markdown",".txt"]}}]});
    await importFile(await handle.getFile(),handle);
  } catch (err) { if (err.name!=="AbortError") el("picker").click(); }
}
async function writeBack() {
  const n=notes.get(active), link=linkedFiles.get(active);
  if (!link || !n || savingFile) return;
  savingFile=true; el("writeBack").disabled=true;
  const noteId=n.id, title=n.title, body=n.body;
  const say=msg=>{if(active===noteId) status(msg);};
  try {
    const actual = await (await link.handle.getFile()).text();
    if (actual!==link.source) { say("原文件已在别处修改。请先导出当前笔记，再重新打开文件。"); return; }
    if (title===link.title && body===link.body) { say("原文件已是最新版本"); return; }
    let value=link.hasHeading || title!==link.title ? serialize({title,body}) : body;
    if (link.source.includes("\r\n")) value=value.replace(/\r?\n/g,"\r\n");
    const stream=await link.handle.createWritable();
    await stream.write(value); await stream.close();
    Object.assign(link,{source:value,title,body,hasHeading:link.hasHeading || title!==link.title});
    say("已写入 " + link.handle.name);
  } catch { say("写入失败，可以用「导出 .md」保存副本"); }
  finally { savingFile=false; el("writeBack").disabled=false; }
}
function setShelf(open) {
  el("shelf").classList.toggle("shown",open); el("shade").hidden=!open;
  el("showShelf").setAttribute("aria-expanded",String(open));
  if(open) el("search").focus();
}
el("new").onclick=()=>startNote();
el("search").oninput=drawList;
el("title").oninput=el("body").oninput=change;
el("edit").onclick=()=>{editing=true;render();el("body").focus();};
el("read").onclick=()=>{editing=false;render();};
el("openFile").onclick=openFile;
el("picker").onchange=async event=>{
  const file=event.target.files[0];
  try { if(file) await importFile(file); } catch { status("打开文件失败，请重试"); }
  event.target.value="";
};
el("download").onclick=exportNote; el("writeBack").onclick=writeBack;
el("remove").onclick=()=>{el("confirmRemove").returnValue="";el("confirmRemove").showModal();};
el("confirmRemove").onclose=()=>{
  if (el("confirmRemove").returnValue!=="remove" || !active) return;
  try { localStorage.removeItem(noteKey(active)); } catch { status("移除失败，浏览器存储不可用"); return; }
  notes.delete(active); linkedFiles.delete(active); storedText.delete(active); unsaved.delete(active);
  active=sorted()[0]?.id || ""; editing=false; render("已移除浏览器中的副本");
};
el("showShelf").onclick=()=>setShelf(true);
el("shade").onclick=el("closeShelf").onclick=()=>{setShelf(false);el("showShelf").focus();};
document.addEventListener("keydown",event=>{
  if(el("confirmRemove").open) return;
  if(event.key==="Escape" && !el("shade").hidden) { setShelf(false);el("showShelf").focus(); }
  if(event.key==="/" && !event.ctrlKey && !event.metaKey && !event.altKey && !["INPUT","TEXTAREA"].includes(event.target.tagName)) {
    event.preventDefault(); if(matchMedia("(max-width:760px)").matches) setShelf(true); el("search").focus();
  }
});
window.addEventListener("storage",event=>{
  if (!event.key?.startsWith(noteKey(""))) return;
  const id=event.key.slice(noteKey("").length);
  if(unsaved.has(id)) return;
  if(active===id && editing) { status("其他标签页已修改此笔记，继续输入会另存为副本"); return; }
  if(event.newValue) {
    try { const n=loadNote(event.newValue); notes.set(id,n); storedText.set(id,event.newValue); } catch { return; }
  } else { notes.delete(id); storedText.delete(id); linkedFiles.delete(id); }
  if(!notes.has(active)) active=sorted()[0]?.id || "";
  if(editing) drawList(); else render();
});
window.addEventListener("beforeunload",event=>{if(unsaved.size){event.preventDefault();event.returnValue="";}});
init();
