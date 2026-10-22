import { NextRequest, NextResponse } from "next/server";

interface Top3Item {
  rank: number;
  name: string;
  finishtime: string;
  timestamp?: string;
}

// 구글 시트가 날짜 형식으로 자동 변환한 경우(예: 'Sat Dec 30 1899 00:15:00 GMT+0827...')에서 순수 mm:ss 시간만 추출
function cleanTimeFormat(raw: unknown): string {
  if (!raw) return "00:00";
  const str = String(raw).trim();

  // 이미 00:15 형식인 경우
  if (/^\d{1,2}:\d{2}$/.test(str)) {
    const parts = str.split(":");
    return `${parts[0].padStart(2, "0")}:${parts[1]}`;
  }

  // Date 객체 문자열 (예: Sat Dec 30 1899 00:15:00 GMT...)
  const timeMatch = str.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (timeMatch) {
    const min = timeMatch[2]; // 분
    const sec = timeMatch[3]; // 초
    return `${min}:${sec}`;
  }

  // 단순 숫자(초)인 경우
  const num = parseInt(str, 10);
  if (!isNaN(num)) {
    const m = Math.floor(num / 60);
    const s = num % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return str;
}

// mm:ss 문자열을 초(seconds) 단위로 파싱
function parseTimeToSeconds(timeStr: string): number {
  const clean = cleanTimeFormat(timeStr);
  const parts = clean.split(":");
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const s = parseInt(parts[1], 10) || 0;
    return m * 60 + s;
  }
  return 999999;
}

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1qM-rJy6EjmN8huqBUYWCII9ZQv_pbWSrQJ2emYKffBs/gviz/tq?tqx=out:csv";

// CSV 텍스트에서 최신 행들을 읽어 완벽한 오름차순(가장 빠른 순) TOP 3 계산
async function fetchTop3FromSheetDirectly(): Promise<Top3Item[]> {
  try {
    const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
    const csv = await res.text();
    const lines = csv.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length <= 1) return [];

    const records: { name: string; finishtime: string; seconds: number }[] = [];

    // 1행(헤더) 제외하고 순회
    for (let i = 1; i < lines.length; i++) {
      // CSV 파싱 (따옴표 제거)
      const matches = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
      const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
      if (cols.length >= 3) {
        const name = cols[1];
        const rawTime = cols[2];
        const clean = cleanTimeFormat(rawTime);
        const sec = parseTimeToSeconds(clean);
        if (name && clean) {
          records.push({ name, finishtime: clean, seconds: sec });
        }
      }
    }

    // 초 기준 오름차순 정렬 (가장 적은 초 = 1등)
    records.sort((a, b) => a.seconds - b.seconds);

    return records.slice(0, 3).map((item, idx) => ({
      rank: idx + 1,
      name: item.name,
      finishtime: item.finishtime,
    }));
  } catch (err) {
    console.error("fetchTop3FromSheetDirectly error:", err);
    return [];
  }
}

// 1. GET: 현재 TOP 3 랭킹 조회
export async function GET() {
  try {
    const top3 = await fetchTop3FromSheetDirectly();
    return NextResponse.json({ result: "success", top3 });
  } catch (error) {
    console.error("GET Top 3 error:", error);
    return NextResponse.json({ error: "Failed to fetch top 3" }, { status: 500 });
  }
}

// 2. POST: 클리어 기록 저장 후 즉시 최신 TOP 3 랭킹 계산 및 반환
export async function POST(req: NextRequest) {
  const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL;

  try {
    const body = await req.json();

    // 1. Google Apps Script로 새 기록 전송
    if (scriptUrl) {
      try {
        await fetch(scriptUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(body),
          redirect: "follow",
        });
      } catch (e) {
        console.error("GAS POST error:", e);
      }
    }

    // 2. 구글 시트에서 직접 최신 데이터 읽어서 정밀 오름차순 TOP 3 산출
    let top3 = await fetchTop3FromSheetDirectly();

    // 혹시 시트 동기화 지연으로 아직 방금 저장한 기록이 포함 안 된 경우 수동 병합
    const mySeconds = parseTimeToSeconds(body.finishtime);
    const hasMe = top3.some((t) => t.name === body.name && t.finishtime === cleanTimeFormat(body.finishtime));

    if (!hasMe && mySeconds < 999999) {
      const merged = [
        ...top3.map((t) => ({ ...t, seconds: parseTimeToSeconds(t.finishtime) })),
        { rank: 0, name: body.name, finishtime: cleanTimeFormat(body.finishtime), seconds: mySeconds },
      ];
      merged.sort((a, b) => a.seconds - b.seconds);
      top3 = merged.slice(0, 3).map((item, idx) => ({
        rank: idx + 1,
        name: item.name,
        finishtime: item.finishtime,
      }));
    }

    return NextResponse.json({
      result: "success",
      saved: body,
      top3,
    });
  } catch (err) {
    console.error("POST Record error:", err);
    return NextResponse.json({ error: "Failed to save record" }, { status: 500 });
  }
}
