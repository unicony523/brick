"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import {
  playBrickBreakSound,
  playPaddleHitSound,
  playWallHitSound,
  playCountdownBeep,
  playPixelFireworkSound,
  playLifeLostSound,
} from "@/lib/sound";
import {
  Play,
  Pause,
  RotateCcw,
  Heart,
  Trophy,
  Flame,
  Volume2,
  VolumeX,
  User,
  GraduationCap,
  Sparkles,
} from "lucide-react";

// 블록 색상 정보 정의
type BrickColorType = "red" | "orange" | "yellow" | "blue" | "green" | "purple";

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  colorType: BrickColorType;
  color: string;
  glow: string;
  alive: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
}

const COLOR_MAP: Record<BrickColorType, { fill: string; stroke: string; glow: string }> = {
  red: { fill: "#EF4444", stroke: "#DC2626", glow: "rgba(239, 68, 68, 0.6)" },
  orange: { fill: "#F97316", stroke: "#EA580C", glow: "rgba(249, 115, 22, 0.6)" },
  yellow: { fill: "#FACC15", stroke: "#EAB308", glow: "rgba(250, 204, 21, 0.6)" },
  green: { fill: "#22C55E", stroke: "#16A34A", glow: "rgba(34, 197, 94, 0.6)" },
  blue: { fill: "#3B82F6", stroke: "#2563EB", glow: "rgba(59, 130, 246, 0.6)" },
  purple: { fill: "#A855F7", stroke: "#9333EA", glow: "rgba(168, 85, 247, 0.6)" },
};

export default function GamePage() {
  // 입력 폼 상태
  const [userName, setUserName] = useState("");
  const [department, setDepartment] = useState("");
  const [studentId, setStudentId] = useState("");

  // 게임 페이즈: 'start' (시작폼) | 'playing' | 'paused' | 'success' | 'gameover'
  const [phase, setPhase] = useState<"start" | "playing" | "paused" | "success" | "gameover">("start");

  // 상위 3명 랭킹 목록 상태
  const [top3List, setTop3List] = useState<{ rank: number; name: string; finishtime: string }[]>([]);

  // 게임 스탯
  const [lives, setLives] = useState(3);
  const [redBrokenCount, setRedBrokenCount] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0); // 초 단위
  const [finalTimeStr, setFinalTimeStr] = useState("00:00");
  const [isMuted, setIsMuted] = useState(false);

  // 캔버스 및 오디오 Ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 게임 엔티티 Refs
  const paddleRef = useRef({
    x: 350,
    y: 560,
    w: 110,
    h: 16,
    speed: 9,
    dx: 0,
  });

  const ballRef = useRef({
    x: 400,
    y: 530,
    radius: 9,
    speed: 4.8,
    dx: 3.3,
    dy: -3.5,
  });

  const bricksRef = useRef<Brick[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const keysRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false });
  const touchStartRef = useRef<{ x: number; paddleX: number } | null>(null);

  // 미션 성공 여부와 진행 상태 캐시 ref (requestAnimationFrame 루프 내부용)
  const gameStateRef = useRef({
    phase: "start",
    lives: 3,
    redBrokenCount: 0,
    isCountingDown: false,
  });

  useEffect(() => {
    gameStateRef.current.phase = phase;
    gameStateRef.current.lives = lives;
    gameStateRef.current.redBrokenCount = redBrokenCount;
    gameStateRef.current.isCountingDown = countdown !== null;
  }, [phase, lives, redBrokenCount, countdown]);

  // 배경음악 초기화
  useEffect(() => {
    const audio = new Audio("/Hyper_Speed_Run.mp3");
    audio.loop = true;
    audio.volume = 0.28; // 볼륨이 너무 크지 않도록 28%로 설정
    bgmRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  // BGM 토글
  const toggleMute = () => {
    if (bgmRef.current) {
      bgmRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  // 벽돌 그리드 생성 (5행 8열 = 40개, 빨강 정확히 30% = 12개)
  const initializeBricks = () => {
    const rows = 5;
    const cols = 8;
    const totalBricks = rows * cols; // 40
    const redCount = Math.round(totalBricks * 0.3); // 12개

    // 12개의 red와 28개의 다른 색상(주황, 노랑, 초록, 파랑, 보라) 생성
    const otherColors: BrickColorType[] = ["orange", "yellow", "green", "blue", "purple"];
    const colorList: BrickColorType[] = Array(redCount).fill("red");
    for (let i = 0; i < totalBricks - redCount; i++) {
      const randomColor = otherColors[Math.floor(Math.random() * otherColors.length)];
      colorList.push(randomColor);
    }

    // 색상 배열 무작위 셔플 (Fisher-Yates)
    for (let i = colorList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [colorList[i], colorList[j]] = [colorList[j], colorList[i]];
    }

    const canvasWidth = 800;
    const padding = 10;
    const marginTop = 35;
    const marginLeft = 35;
    const brickW = (canvasWidth - marginLeft * 2 - padding * (cols - 1)) / cols;
    const brickH = 22;

    const bricks: Brick[] = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cType = colorList[idx++];
        bricks.push({
          x: marginLeft + c * (brickW + padding),
          y: marginTop + r * (brickH + padding),
          w: brickW,
          h: brickH,
          colorType: cType,
          color: COLOR_MAP[cType].fill,
          glow: COLOR_MAP[cType].glow,
          alive: true,
        });
      }
    }
    bricksRef.current = bricks;
  };

  // 파티클 생성
  const spawnParticles = (x: number, y: number, color: string) => {
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4 + 1;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 4 + 2,
        color,
        alpha: 1,
        life: 1,
      });
    }
  };

  // 디바이스 판별 함수 (모바일 여부 확인)
  const isMobileDevice = () => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  };

  // 공 & 패들 위치 리셋 (모바일 모드에서는 패들 길이를 약 1.5배 이상 확장하여 쾌적하게 설정)
  const resetBallAndPaddle = () => {
    const isMobile = isMobileDevice();
    // 모바일에서는 기존 110px에서 170px로 시원하게 확장, PC는 110px 유지
    paddleRef.current.w = isMobile ? 170 : 110;
    paddleRef.current.x = 400 - paddleRef.current.w / 2;
    paddleRef.current.y = 560;
    ballRef.current.x = 400;
    ballRef.current.y = 530;

    const angle = (Math.PI / 4) + (Math.random() * Math.PI / 2); // 45도 ~ 135도 상향
    const spd = ballRef.current.speed;
    ballRef.current.dx = Math.cos(angle) * spd * (Math.random() > 0.5 ? 1 : -1);
    ballRef.current.dy = -Math.abs(Math.sin(angle) * spd);
  };

  // 분:초 포맷팅 함수
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // 폭죽 팡팡 연출 및 사운드 트리거
  const triggerVictoryFireworks = () => {
    // 픽셀 폭죽 사운드 즉시 1회 재생
    playPixelFireworkSound();

    const duration = 3.5 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

    function randomInRange(min: number, max: number) {
      return Math.random() * (max - min) + min;
    }

    const interval: NodeJS.Timeout = setInterval(function () {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      // 폭죽 파티클 발사
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.4), y: Math.random() - 0.2 },
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.6, 0.9), y: Math.random() - 0.2 },
      });

      // 중간 주기마다 픽셀 사운드 재생
      if (Math.random() > 0.55) {
        playPixelFireworkSound();
      }
    }, 350);
  };

  // 게임 시작 (카운트다운 포함)
  const startGame = () => {
    if (!userName.trim()) {
      alert("사용자 이름을 입력해주세요!");
      return;
    }

    initializeBricks();
    resetBallAndPaddle();
    particlesRef.current = [];
    setLives(3);
    setRedBrokenCount(0);
    setElapsedTime(0);
    setPhase("playing");

    // 카운트다운 3, 2, 1 시작 (게임 첫 시작 시에만)
    setCountdown(3);
    playCountdownBeep(false);

    let count = 3;
    const countInterval = setInterval(() => {
      count -= 1;
      if (count > 0) {
        setCountdown(count);
        playCountdownBeep(false);
      } else if (count === 0) {
        // "START!" 표시와 동시에 카운트다운 완료 처리하여 0.3초 깜빡임 지연 제거
        setCountdown(0);
        playCountdownBeep(true);
        clearInterval(countInterval);

        // 아주 짧은 딜레이(250ms) 후 오버레이를 완전히 걷고 즉시 플레이 시작
        setTimeout(() => {
          setCountdown(null);
        }, 250);

        // BGM 재생 시작 (사용자 브라우저 정책 처리)
        if (bgmRef.current) {
          bgmRef.current.currentTime = 0;
          const playPromise = bgmRef.current.play();
          if (playPromise !== undefined) {
            playPromise.catch((error) => {
              console.log("Audio play postponed:", error);
            });
          }
        }
      }
    }, 850);
  };

  // 일시정지 / 계속하기 토글
  const togglePause = () => {
    if (phase === "playing") {
      setPhase("paused");
      if (bgmRef.current) bgmRef.current.pause();
    } else if (phase === "paused") {
      setPhase("playing");
      if (bgmRef.current && !isMuted) bgmRef.current.play().catch(() => {});
    }
  };

  // 다시 시작 (이름 작성 첫 화면으로)
  const handleRestartToHome = () => {
    if (bgmRef.current) {
      bgmRef.current.pause();
      bgmRef.current.currentTime = 0;
    }
    setPhase("start");
    setCountdown(null);
  };

  // 구글 앱스 스크립트 웹앱 URL (배포 후 아래 변수에 넣거나 NEXT_PUBLIC_GOOGLE_SCRIPT_URL 환경변수 사용)
  const GOOGLE_SCRIPT_URL = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL || "";
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // 게임 성공 시 구글 시트에 데이터 전송 및 TOP 3 랭킹 수신
  const saveRecordToGoogleSheets = async (name: string, finishTimeStr: string) => {
    try {
      setSaveStatus("saving");
      const now = new Date();
      const timestamp = new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now);

      // 내부 API 라우트를 통해 Google Apps Script 호출 (CORS 회피 및 실시간 응답 수신)
      const res = await fetch("/api/ranking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestamp: timestamp,
          name: name,
          finishtime: finishTimeStr,
        }),
      });

      const data = await res.json();
      if (data && data.top3 && Array.isArray(data.top3)) {
        setTop3List(data.top3);
      }
      setSaveStatus("saved");
    } catch (err) {
      console.error("Failed to save and fetch rankings:", err);
      setSaveStatus("error");
    }
  };

  // 게임 성공 처리 (빨간 벽돌 3개 제거 성공 시에만 동작)
  const handleGameSuccess = useCallback(() => {
    setPhase("success");
    const formatted = formatTime(elapsedTime);
    setFinalTimeStr(formatted);

    if (bgmRef.current) {
      bgmRef.current.pause();
    }

    triggerVictoryFireworks();

    // 구글 시트에 기록 전송
    saveRecordToGoogleSheets(userName, formatted);
  }, [elapsedTime, userName]);

  // 게임 오버 처리 (미션 실패)
  const handleGameOver = useCallback(() => {
    setPhase("gameover");
    playLifeLostSound();
    if (bgmRef.current) {
      bgmRef.current.pause();
    }
  }, []);

  // 타이머 작동 (playing 상태이며 카운트다운이 끝났을 때만)
  useEffect(() => {
    if (phase === "playing" && countdown === null) {
      timerRef.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, countdown]);

  // 키보드 조작 이벤트 (PC 좌우 방향키)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.code === "ArrowLeft") {
        keysRef.current.left = true;
      } else if (e.key === "ArrowRight" || e.code === "ArrowRight") {
        keysRef.current.right = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.code === "ArrowLeft") {
        keysRef.current.left = false;
      } else if (e.key === "ArrowRight" || e.code === "ArrowRight") {
        keysRef.current.right = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // 모바일 터치 / 스와이프 조작
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        paddleX: paddleRef.current.x,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!touchStartRef.current || e.touches.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const currentX = e.touches[0].clientX;
    const deltaX = currentX - touchStartRef.current.x;

    // 캔버스 반응형 스케일 계산
    const rect = canvas.getBoundingClientRect();
    const scaleFactor = 800 / rect.width;

    const newPaddleX = touchStartRef.current.paddleX + deltaX * scaleFactor;
    paddleRef.current.x = Math.max(0, Math.min(800 - paddleRef.current.w, newPaddleX));
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
  };

  // 게임 메인 루프 (캔버스 렌더링 & 물리 엔진)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const loop = () => {
      // 1. 화면 초기화
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 모던 다크 배경 그라데이션
      const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bgGrad.addColorStop(0, "#090d16");
      bgGrad.addColorStop(0.5, "#0f172a");
      bgGrad.addColorStop(1, "#080c14");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 미세 그리드 배경 효과
      ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      const paddle = paddleRef.current;
      const ball = ballRef.current;
      const bricks = bricksRef.current;
      const isPlay = gameStateRef.current.phase === "playing" && !gameStateRef.current.isCountingDown;

      // 2. 패들 업데이트 (PC 방향키)
      if (isPlay) {
        if (keysRef.current.left) {
          paddle.x -= paddle.speed;
        }
        if (keysRef.current.right) {
          paddle.x += paddle.speed;
        }
        paddle.x = Math.max(0, Math.min(canvas.width - paddle.w, paddle.x));
      }

      // 3. 공 물리 및 충돌 처리
      if (isPlay) {
        ball.x += ball.dx;
        ball.y += ball.dy;

        // 좌/우 벽 충돌
        if (ball.x - ball.radius <= 0) {
          ball.x = ball.radius;
          ball.dx = -ball.dx;
          playWallHitSound();
        } else if (ball.x + ball.radius >= canvas.width) {
          ball.x = canvas.width - ball.radius;
          ball.dx = -ball.dx;
          playWallHitSound();
        }

        // 상단 벽 충돌
        if (ball.y - ball.radius <= 0) {
          ball.y = ball.radius;
          ball.dy = -ball.dy;
          playWallHitSound();
        }

        // 하단 낙하 (생명 차감)
        if (ball.y - ball.radius > canvas.height) {
          const currentLives = gameStateRef.current.lives - 1;
          setLives(currentLives);

          if (currentLives <= 0) {
            handleGameOver();
          } else {
            playLifeLostSound();
            resetBallAndPaddle();
          }
        }

        // 패들과 공 충돌
        if (
          ball.y + ball.radius >= paddle.y &&
          ball.y - ball.radius <= paddle.y + paddle.h &&
          ball.x + ball.radius >= paddle.x &&
          ball.x - ball.radius <= paddle.x + paddle.w &&
          ball.dy > 0
        ) {
          playPaddleHitSound();
          ball.y = paddle.y - ball.radius;

          // 충돌 지점에 따른 튕김 각도 조절 (자연스러운 컨트롤)
          const hitPos = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
          const maxBounceAngle = Math.PI / 3; // 60도
          const bounceAngle = hitPos * maxBounceAngle;
          const currentSpeed = Math.sqrt(ball.dx * ball.dx + ball.dy * ball.dy);

          ball.dx = currentSpeed * Math.sin(bounceAngle);
          ball.dy = -currentSpeed * Math.cos(bounceAngle);
        }

        // 벽돌 충돌 처리
        for (let i = 0; i < bricks.length; i++) {
          const b = bricks[i];
          if (!b.alive) continue;

          // 공과 벽돌 AABB 충돌 체크
          if (
            ball.x + ball.radius >= b.x &&
            ball.x - ball.radius <= b.x + b.w &&
            ball.y + ball.radius >= b.y &&
            ball.y - ball.radius <= b.y + b.h
          ) {
            b.alive = false;
            playBrickBreakSound();
            spawnParticles(b.x + b.w / 2, b.y + b.h / 2, b.color);

            // 반사 방향 계산
            const prevX = ball.x - ball.dx;
            const prevY = ball.y - ball.dy;

            if (prevX + ball.radius <= b.x || prevX - ball.radius >= b.x + b.w) {
              ball.dx = -ball.dx;
            } else {
              ball.dy = -ball.dy;
            }

            // 빨간 벽돌 카운트 처리
            if (b.colorType === "red") {
              const newRedCount = gameStateRef.current.redBrokenCount + 1;
              setRedBrokenCount(newRedCount);

              // 빨간 벽돌 3개 달성 시 미션 완료
              if (newRedCount >= 3) {
                handleGameSuccess();
              }
            }
            break;
          }
        }
      }

      // 4. 벽돌 그리기
      for (const b of bricks) {
        if (!b.alive) continue;

        ctx.save();
        ctx.shadowColor = b.glow;
        ctx.shadowBlur = 10;
        ctx.fillStyle = b.color;

        // 라운드 박스
        const r = 4;
        ctx.beginPath();
        ctx.moveTo(b.x + r, b.y);
        ctx.lineTo(b.x + b.w - r, b.y);
        ctx.quadraticCurveTo(b.x + b.w, b.y, b.x + b.w, b.y + r);
        ctx.lineTo(b.x + b.w, b.y + b.h - r);
        ctx.quadraticCurveTo(b.x + b.w, b.y + b.h, b.x + b.w - r, b.y + b.h);
        ctx.lineTo(b.x + r, b.y + b.h);
        ctx.quadraticCurveTo(b.x, b.y + b.h, b.x, b.y + b.h - r);
        ctx.lineTo(b.x, b.y + r);
        ctx.quadraticCurveTo(b.x, b.y, b.x + r, b.y);
        ctx.closePath();
        ctx.fill();

        // 윗면 하이라이트 입체감
        ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
        ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, 3);

        // 빨간 벽돌 특수 마크 (목표 대상 표시)
        if (b.colorType === "red") {
          ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
          ctx.beginPath();
          ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      // 5. 파티클 그리기 및 업데이트
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1; // 중력
        p.alpha -= 0.025;

        if (p.alpha <= 0) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 6. 패들 그리기
      ctx.save();
      ctx.shadowColor = "#38bdf8";
      ctx.shadowBlur = 14;

      const pGrad = ctx.createLinearGradient(paddle.x, paddle.y, paddle.x, paddle.y + paddle.h);
      pGrad.addColorStop(0, "#38bdf8");
      pGrad.addColorStop(1, "#0284c7");
      ctx.fillStyle = pGrad;

      const pr = 8;
      ctx.beginPath();
      ctx.moveTo(paddle.x + pr, paddle.y);
      ctx.lineTo(paddle.x + paddle.w - pr, paddle.y);
      ctx.quadraticCurveTo(paddle.x + paddle.w, paddle.y, paddle.x + paddle.w, paddle.y + pr);
      ctx.lineTo(paddle.x + paddle.w, paddle.y + paddle.h - pr);
      ctx.quadraticCurveTo(paddle.x + paddle.w, paddle.y + paddle.h, paddle.x + paddle.w - pr, paddle.y + paddle.h);
      ctx.lineTo(paddle.x + pr, paddle.y + paddle.h);
      ctx.quadraticCurveTo(paddle.x, paddle.y + paddle.h, paddle.x, paddle.y + paddle.h - pr);
      ctx.lineTo(paddle.x, paddle.y + pr);
      ctx.quadraticCurveTo(paddle.x, paddle.y, paddle.x + pr, paddle.y);
      ctx.closePath();
      ctx.fill();

      // 패들 센터 포인트 표시
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(paddle.x + paddle.w / 2 - 3, paddle.y + 4, 6, paddle.h - 8);
      ctx.restore();

      // 7. 공 그리기
      ctx.save();
      ctx.shadowColor = "#fde047";
      ctx.shadowBlur = 15;
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();

      // 공 반사광
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ball.x - 2.5, ball.y - 2.5, ball.radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    requestRef.current = animId;

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [handleGameOver, handleGameSuccess]);

  return (
    <div className={`flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500 selection:text-white ${phase !== "start" ? "h-screen overflow-hidden" : ""}`}>
      {/* 상단 네비게이션 헤더: 게임 중 모바일에서는 컴팩트하게 축소 */}
      <header className={`w-full border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40 px-3 sm:px-8 flex items-center justify-between ${phase !== "start" ? "py-1.5 sm:py-3" : "py-3"}`}>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative w-7 h-7 sm:w-10 sm:h-10 rounded-full overflow-hidden border border-amber-400/40 bg-amber-500/10 flex items-center justify-center p-0.5 shadow-sm shadow-amber-500/20 shrink-0">
            <Image
              src="/mascot.png"
              alt="INU 횃불이 마스코트"
              width={40}
              height={40}
              unoptimized
              className="object-contain"
            />
          </div>
          <div>
            <h1 className="text-base sm:text-xl font-black tracking-tight text-white flex items-center gap-1.5 sm:gap-2">
              INU 벽돌깨기
              <span className="text-[10px] sm:text-xs font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                횃불이
              </span>
            </h1>
          </div>
        </div>

        {/* 볼륨 컨트롤 */}
        <button
          onClick={toggleMute}
          className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-700 text-slate-300 hover:text-white text-xs transition"
          title={isMuted ? "음소거 해제" : "음소거"}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />}
          <span className="hidden sm:inline">BGM {isMuted ? "OFF" : "ON"}</span>
        </button>
      </header>

      {/* 메인 컨텐츠 영역: 게임 플레이 시 모바일에서 위아래 꽉 채우도록 설정 */}
      <main className={`flex-1 flex flex-col items-center w-full max-w-5xl mx-auto ${phase === "start" ? "justify-center p-3 sm:p-6" : "justify-start sm:justify-center p-1 sm:p-6 overflow-hidden"}`}>
        {phase === "start" ? (
          /* ==================================================== */
          /* 1. 시작 화면 : 마스코트 + 이름 + 제작자 정보 폼      */
          /* ==================================================== */
          <div className="w-full max-w-lg bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 flex flex-col items-center text-center backdrop-blur-xl relative overflow-hidden">
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-amber-500/20 rounded-full blur-3xl pointer-events-none" />

            {/* 마스코트 횃불이 이미지 */}
            <div className="relative mb-5 group">
              <div className="absolute -inset-4 bg-gradient-to-r from-amber-500/30 to-blue-500/30 rounded-full blur-xl group-hover:blur-2xl transition duration-500" />
              <div className="relative w-40 h-40 sm:w-44 sm:h-44 rounded-3xl overflow-hidden border-2 border-slate-700/70 bg-gradient-to-b from-slate-800 to-slate-900 flex items-center justify-center p-3 shadow-2xl">
                <Image
                  src="/mascot.png"
                  alt="인천대학교 마스코트 횃불이"
                  width={160}
                  height={160}
                  priority
                  unoptimized
                  className="object-contain drop-shadow-xl hover:scale-105 transition duration-300"
                />
              </div>
            </div>

            {/* 레트로 블록 컬러 픽셀 타이틀 */}
            <h2 className="text-3xl sm:text-5xl font-black tracking-widest mb-3 font-pixel flex items-center justify-center gap-1 select-none">
              <span className="text-rose-500 drop-shadow-[0_2px_10px_rgba(239,68,68,0.7)]">I</span>
              <span className="text-orange-400 drop-shadow-[0_2px_10px_rgba(251,146,60,0.7)]">N</span>
              <span className="text-yellow-300 drop-shadow-[0_2px_10px_rgba(253,224,71,0.7)]">U</span>
              <span className="mx-1 text-slate-700"> </span>
              <span className="text-emerald-400 drop-shadow-[0_2px_10px_rgba(52,211,153,0.7)]">벽</span>
              <span className="text-blue-400 drop-shadow-[0_2px_10px_rgba(96,165,250,0.7)]">돌</span>
              <span className="text-purple-400 drop-shadow-[0_2px_10px_rgba(192,132,252,0.7)]">깨</span>
              <span className="text-pink-400 drop-shadow-[0_2px_10px_rgba(244,114,182,0.7)]">기</span>
            </h2>
            <p className="text-slate-400 text-xs sm:text-sm mb-7 max-w-sm font-sans">
              인천대학교 공식 마스코트 <strong>횃불이</strong>와 함께하는 짜릿한 벽돌깨기! 빨간 벽돌 3개를 격파하면 미션 클리어!
            </p>

            {/* 입력 폼 필드: 도전자 이름, 학과, 학번 모두 픽셀 글씨체 적용 */}
            <div className="w-full space-y-3.5 mb-6 text-left font-pixel">
              <div>
                <label className="block text-sm font-bold text-yellow-300 mb-1.5 flex items-center gap-2 tracking-wider">
                  <User className="w-4 h-4 text-cyan-400" />
                  도전자 이름 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="이름을 입력하세요"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") startGame();
                  }}
                  className="w-full px-4 py-3 rounded-xl bg-slate-950/90 border-2 border-slate-700 text-yellow-200 placeholder-slate-600 text-base font-pixel tracking-wider focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/40 transition shadow-inner"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-cyan-300 mb-1 flex items-center gap-1.5 tracking-wider">
                    <GraduationCap className="w-3.5 h-3.5 text-amber-400" />
                    학과
                  </label>
                  <input
                    type="text"
                    placeholder="예: 컴퓨터공학부"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/90 border border-slate-700 text-cyan-200 placeholder-slate-600 text-sm font-pixel tracking-wider focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-cyan-300 mb-1 flex items-center gap-1.5 tracking-wider">
                    <GraduationCap className="w-3.5 h-3.5 text-amber-400" />
                    학번
                  </label>
                  <input
                    type="text"
                    placeholder="예: 202401234"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/90 border border-slate-700 text-cyan-200 placeholder-slate-600 text-sm font-pixel tracking-wider focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition"
                  />
                </div>
              </div>
            </div>

            {/* 시작 버튼: 픽셀 아케이드 버튼 스타일 */}
            <button
              onClick={startGame}
              className="w-full py-4 px-6 rounded-xl font-bold text-base sm:text-lg text-white font-pixel tracking-widest bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 shadow-lg shadow-indigo-500/30 active:scale-[0.98] transition flex items-center justify-center gap-2.5 border border-indigo-400/40 pixel-text-shadow cursor-pointer"
            >
              <Play className="w-5 h-5 fill-current text-yellow-300 animate-pulse" />
              게임 시작하기
            </button>

            <div className="mt-4 text-[12px] text-slate-400 flex items-center justify-center gap-4">
              <span>🎮 PC: 방향키(←, →)</span>
              <span>📱 모바일: 좌우 스와이프</span>
            </div>
          </div>
        ) : (
          /* ==================================================== */
          /* 2. 게임 실행 화면 (HUD + 캔버스 + 컨트롤 버튼)       */
          /* ==================================================== */
          <div className="w-full flex-1 flex flex-col items-center justify-between sm:justify-center max-h-full">
            {/* 상단 HUD 대시보드 */}
            <div className="w-full max-w-[800px] mb-1 sm:mb-3 flex items-center justify-between gap-2 bg-slate-900/90 border border-slate-800 rounded-xl px-2.5 py-1.5 sm:px-4 sm:py-2.5 backdrop-blur-md shadow-md shrink-0">
              {/* 플레이어 및 생명 */}
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="text-[11px] sm:text-xs">
                  <span className="text-slate-400">도전자:</span>{" "}
                  <strong className="text-slate-100">{userName}</strong>
                </div>
                <div className="h-3.5 w-[1px] bg-slate-700" />
                <div className="flex items-center gap-0.5 sm:gap-1">
                  {[...Array(3)].map((_, i) => (
                    <Heart
                      key={i}
                      className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${
                        i < lives
                          ? "text-rose-500 fill-rose-500 drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]"
                          : "text-slate-600"
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* 미션 목표 달성률 (빨간 블록 3개 제거) */}
              <div className="flex items-center gap-1.5 bg-slate-950/60 px-2 py-0.5 sm:px-3 sm:py-1 rounded-lg border border-red-500/20">
                <Flame className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-500 fill-red-500 animate-pulse" />
                <span className="text-[11px] sm:text-xs font-semibold text-slate-300">
                  빨간 벽돌: <span className="text-red-400 font-bold">{redBrokenCount}</span> / 3
                </span>
              </div>

              {/* 시간 및 제어 버튼 */}
              <div className="flex items-center gap-1.5 sm:gap-3">
                <div className="text-[11px] sm:text-xs font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded">
                  ⏱ {formatTime(elapsedTime)}
                </div>

                {/* 일시정지 버튼 */}
                <button
                  onClick={togglePause}
                  className="p-1 sm:p-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                  title={phase === "paused" ? "계속하기" : "일시정지"}
                >
                  {phase === "paused" ? <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                </button>

                {/* 다시 시작 버튼 */}
                <button
                  onClick={handleRestartToHome}
                  className="flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] sm:text-xs font-medium transition"
                  title="다시 시작 (이름 입력 화면으로)"
                >
                  <RotateCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  <span className="hidden xs:inline">다시 시작</span>
                </button>
              </div>
            </div>

            {/* 캔버스 컨테이너: 모바일에서는 위아래로 길쭉하게 화면을 가득 채움 */}
            <div className="relative w-full max-w-[800px] flex-1 min-h-[60vh] max-h-[82vh] sm:max-h-none sm:aspect-[4/3] rounded-2xl overflow-hidden border-2 border-slate-800 bg-slate-950 shadow-2xl flex items-center justify-center">
              <canvas
                ref={canvasRef}
                width={800}
                height={600}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="w-full h-full object-fill sm:object-contain block cursor-none touch-none"
              />

              {/* 3, 2, 1 카운트다운 오버레이: 뒷배경 게임 화면이 은은하고 흐릿하게 투영되어 보이도록 반투명 블러 적용 */}
              {countdown !== null && (
                <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px] transition-opacity duration-200 flex flex-col items-center justify-center pointer-events-none select-none z-20">
                  <span className="text-8xl sm:text-9xl font-black font-pixel text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 via-amber-400 to-orange-500 drop-shadow-[0_0_35px_rgba(251,191,36,0.6)] animate-ping duration-700">
                    {countdown === 0 ? "START!" : countdown}
                  </span>
                  <p className="mt-6 text-xs sm:text-sm text-yellow-300 font-pixel tracking-wider px-4 py-1.5 rounded-full bg-slate-900/80 border border-yellow-400/30">
                    좌우 방향키나 화면을 스와이프해 패들을 조작하세요!
                  </p>
                </div>
              )}

              {/* 일시 정지 오버레이 */}
              {phase === "paused" && (
                <div className="absolute inset-0 bg-black/75 backdrop-blur-md flex flex-col items-center justify-center z-20">
                  <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-700 text-center max-w-xs shadow-2xl">
                    <Pause className="w-12 h-12 text-blue-400 mx-auto mb-2 animate-bounce" />
                    <h3 className="text-xl font-bold text-white mb-2">게임 일시 정지</h3>
                    <p className="text-xs text-slate-400 mb-5">잠시 숨을 고르고 준비되시면 계속하기를 눌러주세요.</p>
                    <button
                      onClick={togglePause}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl transition"
                    >
                      게임 계속하기
                    </button>
                  </div>
                </div>
              )}

              {/* 미션 성공 모달 오버레이 */}
              {phase === "success" && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-4 z-30 animate-in fade-in zoom-in duration-300">
                  <div className="bg-slate-900/95 border-2 border-amber-400/50 rounded-2xl p-6 sm:p-8 max-w-md w-full text-center shadow-2xl shadow-amber-500/20">
                    <div className="relative mx-auto w-16 h-16 rounded-full bg-amber-500/20 border border-amber-400 flex items-center justify-center mb-4">
                      <Trophy className="w-9 h-9 text-amber-400 animate-pulse" />
                      <Sparkles className="w-5 h-5 text-amber-300 absolute -top-1 -right-1" />
                    </div>

                    <h3 className="text-2xl sm:text-3xl font-black text-white mb-1">
                      🎉 미션 클리어! 🎉
                    </h3>
                    <p className="text-slate-300 text-sm mb-4">
                      <strong className="text-amber-300">{userName}</strong>님, 빨간 벽돌 3개를 모두 격파하였습니다!
                    </p>

                    {/* 완료 시간 및 정보 카드 */}
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 mb-4 text-left space-y-1.5 text-xs">
                      <div className="flex justify-between text-slate-300">
                        <span>🎯 격파 미션:</span>
                        <span className="font-semibold text-emerald-400">성공 (3/3 달성)</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>⏱ 나의 클리어 시간:</span>
                        <strong className="text-amber-400 font-mono text-sm">{finalTimeStr}</strong>
                      </div>
                      {saveStatus === "saving" && (
                        <div className="text-[11px] text-amber-400 pt-1 flex items-center gap-1">
                          <span>⏳ 구글 시트에 기록 저장 및 순위 조회 중...</span>
                        </div>
                      )}
                      {saveStatus === "saved" && (
                        <div className="text-[11px] text-emerald-400 pt-1 flex items-center gap-1">
                          <span>✓ 구글 시트에 정상 등록되었습니다!</span>
                        </div>
                      )}
                    </div>

                    {/* 실시간 구글 시트 TOP 3 명예의 전당 */}
                    <div className="w-full bg-slate-950/90 border border-amber-500/30 rounded-xl p-3 mb-5 text-left">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                          <Trophy className="w-3.5 h-3.5 text-amber-400" />
                          명예의 전당 TOP 3 (가장 빠른 순)
                        </span>
                        <span className="text-[10px] text-slate-400">오름차순</span>
                      </div>

                      {top3List.length > 0 ? (
                        <div className="space-y-1.5">
                          {top3List.map((item, index) => {
                            const badgeColor =
                              index === 0
                                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                : index === 1
                                ? "bg-slate-300/20 text-slate-200 border-slate-400/40"
                                : "bg-orange-600/20 text-orange-300 border-orange-500/40";
                            const medal = index === 0 ? "🥇 1위" : index === 1 ? "🥈 2위" : "🥉 3위";

                            return (
                              <div
                                key={index}
                                className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${badgeColor}`}
                              >
                                <div className="flex items-center gap-2.5 overflow-hidden">
                                  <span className="font-extrabold shrink-0">{medal}</span>
                                  <span className="font-semibold text-slate-100 truncate max-w-[140px] sm:max-w-[200px]">{item.name}</span>
                                </div>
                                <span className="font-mono font-bold text-sm shrink-0 pl-2">{item.finishtime}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center py-2 text-[11px] text-slate-400">
                          {saveStatus === "saving" ? "순위 데이터를 집계하고 있습니다..." : "기록을 불러오는 중입니다..."}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={handleRestartToHome}
                      className="w-full py-3 bg-gradient-to-r from-amber-500 to-blue-600 hover:from-amber-400 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      처음 화면으로 돌아가기
                    </button>
                  </div>
                </div>
              )}

              {/* 게임 오버 (미션 실패) 모달 오버레이 */}
              {phase === "gameover" && (
                <div className="absolute inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-4 z-30 animate-in fade-in zoom-in duration-300">
                  <div className="bg-slate-900/95 border-2 border-rose-500/50 rounded-2xl p-6 sm:p-8 max-w-md w-full text-center shadow-2xl shadow-rose-500/20">
                    <div className="mx-auto w-16 h-16 rounded-full bg-rose-500/20 border border-rose-400 flex items-center justify-center mb-4">
                      <Heart className="w-8 h-8 text-rose-500" />
                    </div>

                    <h3 className="text-2xl sm:text-3xl font-black text-rose-400 mb-2">
                      게임 미션 실패!
                    </h3>
                    <p className="text-slate-300 text-sm mb-6">
                      생명을 모두 소진하였습니다. 다시 도전해 보세요!
                    </p>

                    <button
                      onClick={handleRestartToHome}
                      className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      이름 작성 화면으로 돌아가기
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 하단 안내 힌트 (모바일에서는 간결하게) */}
            <div className="mt-1.5 sm:mt-3 text-[11px] sm:text-xs text-slate-400 flex items-center justify-center gap-2 sm:gap-4 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1">
                💻 <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">←</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">→</kbd> 방향키로 패들 제어
              </span>
              <span>📱 화면 좌우 스와이프로 패들 이동</span>
            </div>
          </div>
        )}
      </main>

      {/* 푸터 영역: 게임 중에는 숨기거나 컴팩트하게 */}
      <footer className={`w-full border-t border-slate-800/60 py-2 sm:py-3 text-center text-[10px] sm:text-xs text-slate-500 shrink-0 ${phase !== "start" ? "hidden sm:block" : "block"}`}>
        <p>인천대학교 (Incheon National University) • INU 마스코트 횃불이 벽돌깨기</p>
      </footer>
    </div>
  );
}
