import React, { useState, useEffect, useRef } from "react";
import {
  Play, Flame, Shield, Activity, Sparkles, RotateCcw, Heart, Zap,
  Volume2, VolumeX, Trophy, Coins, Skull, Star, HelpCircle, ArrowRight
} from "lucide-react";

// ==========================================
// GAME CONSTANTS & INTERFACES
// ==========================================
interface UpgradeOption {
  id: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  level: number;
  type: "weapon" | "stat";
}

interface Weapon {
  id: string;
  name: string;
  level: number;
  timer: number;
  maxTimer: number;
}

interface Enemy {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  size: number;
  color: string;
  type: "drone" | "charger" | "goliath" | "boss";
  points: number;
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  size: number;
  color: string;
  pierce: number;
}

interface Item {
  x: number;
  y: number;
  amount: number;
  size: number;
  color: string;
  isGold: boolean;
  pulling: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  decay: number;
}

interface DamageText {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
  vy: number;
}

interface HighScore {
  time: string;
  kills: number;
  gold: number;
  level: number;
  date: string;
}

export default function App() {
  // ==========================================
  // REACT STATE (UI, Overlays, Persistent Upgrades)
  // ==========================================
  const [gameState, setGameState] = useState<"START" | "PLAYING" | "GAMEOVER">("START");
  const [isLevelUp, setIsLevelUp] = useState(false);
  const [levelUpOptions, setLevelUpOptions] = useState<UpgradeOption[]>([]);
  const [isMuted, setIsMuted] = useState(() => {
    const saved = localStorage.getItem("pioneer_muted");
    return saved ? JSON.parse(saved) : false;
  });

  // Score stats
  const [gameStats, setGameStats] = useState({
    time: "00:00",
    kills: 0,
    gold: 0,
    level: 1,
    xpPercent: 0,
    hpPercent: 100,
  });

  const [finalStats, setFinalStats] = useState({
    time: "00:00",
    kills: 0,
    gold: 0,
    level: 1,
    unlockedGold: 0
  });

  // Persistent Meta-Progression Shop State (Saved in LocalStorage)
  const [metaGold, setMetaGold] = useState(() => {
    const saved = localStorage.getItem("pioneer_meta_gold");
    return saved ? parseInt(saved, 10) : 0;
  });

  const [shopUpgrades, setShopUpgrades] = useState(() => {
    const saved = localStorage.getItem("pioneer_shop_upgrades");
    return saved
      ? JSON.parse(saved)
      : { damage: 0, health: 0, speed: 0, magnet: 0, regen: 0 };
  });

  const [highScores, setHighScores] = useState<HighScore[]>(() => {
    const saved = localStorage.getItem("pioneer_highscores");
    return saved ? JSON.parse(saved) : [];
  });

  // Ad simulation overlays
  const [adState, setAdState] = useState<{
    visible: boolean;
    type: "REROLL" | "REVIVE" | "DOUBLE_GOLD" | null;
    timer: number;
    title: string;
  }>({
    visible: false,
    type: null,
    timer: 0,
    title: "",
  });

  const [hasRevivedThisRun, setHasRevivedThisRun] = useState(false);
  const [doubleGoldApplied, setDoubleGoldApplied] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // ==========================================
  // PI NETWORK PLATFORM INTEGRATION STATES
  // ==========================================
  const [piUser, setPiUser] = useState<any>(null);
  const [piAuthenticated, setPiAuthenticated] = useState(false);
  const [piPaymentStatus, setPiPaymentStatus] = useState<"idle" | "authenticating" | "creating" | "approving" | "completing" | "success" | "error" | "cancelled">("idle");
  const [piPaymentError, setPiPaymentError] = useState("");
  const [piPaymentType, setPiPaymentType] = useState<"buy" | "sell" | "">("");
  const [payWithPiMode, setPayWithPiMode] = useState(() => {
    if (typeof window !== "undefined") {
      return !!(window as any).Pi;
    }
    return false;
  });
  const [piApiKeyConfigured, setPiApiKeyConfigured] = useState<boolean | null>(null);
  const [shopTab, setShopTab] = useState<"upgrades" | "exchange">("upgrades");

  // Sync state setters to window globally so asynchronous callbacks from the Pi SDK
  // can target the mounted component instance correctly in React StrictMode/HMR double renders.
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__setPiUser = setPiUser;
      (window as any).__setPiAuthenticated = setPiAuthenticated;
      (window as any).__setPiPaymentStatus = setPiPaymentStatus;
      (window as any).__setPiPaymentError = setPiPaymentError;
      (window as any).__setPayWithPiMode = setPayWithPiMode;
      (window as any).__setPiApiKeyConfigured = setPiApiKeyConfigured;
    }
  });

  // ==========================================
  // REFS FOR CANVAS & GAME STATE ENGINE
  // ==========================================
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Engine State Ref to bypass React re-render latency
  const engineRef = useRef({
    player: {
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 100,
      level: 1,
      xp: 0,
      xpNeeded: 50,
      gold: 0,
      kills: 0,
      speed: 1.8,
      magnetRange: 100,
      damageMultiplier: 1.0,
      regenRate: 0, // HP/sec
      size: 14,
    },
    weapons: [] as Weapon[],
    enemies: [] as Enemy[],
    projectiles: [] as Projectile[],
    items: [] as Item[],
    particles: [] as Particle[],
    damageTexts: [] as DamageText[],
    keys: {
      w: false, a: false, s: false, d: false,
      ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false,
    },
    joystick: {
      active: false,
      startX: 0,
      startY: 0,
      curX: 0,
      curY: 0,
    },
    gameTime: 0, // seconds
    spawnTimer: 0,
    isPaused: false,
    bossSpawned: false,
    shieldAngle: 0,
    lastFrameTime: 0,
  });

  // ==========================================
  // PROCEDURAL SOUND MATRIX (Web Audio API)
  // ==========================================
  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
  };

  const playSfx = (type: "shoot" | "hit" | "kill" | "xp" | "levelup" | "hurt" | "revive" | "ad" | "gameover" | "upgrade") => {
    if (isMuted) return;
    try {
      initAudio();
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;

      switch (type) {
        case "shoot":
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(600, now);
          osc.frequency.exponentialRampToValueAtTime(150, now + 0.12);
          gain.gain.setValueAtTime(0.06, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
          osc.start(now);
          osc.stop(now + 0.12);
          break;
        case "hit":
          osc.type = "triangle";
          osc.frequency.setValueAtTime(140, now);
          osc.frequency.setValueAtTime(40, now + 0.08);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
          osc.start(now);
          osc.stop(now + 0.08);
          break;
        case "hurt":
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(180, now);
          osc.frequency.linearRampToValueAtTime(60, now + 0.2);
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
          osc.start(now);
          osc.stop(now + 0.2);
          break;
        case "kill":
          osc.type = "square";
          osc.frequency.setValueAtTime(80, now);
          osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
          osc.start(now);
          osc.stop(now + 0.15);
          break;
        case "xp":
          osc.type = "sine";
          osc.frequency.setValueAtTime(950, now);
          osc.frequency.exponentialRampToValueAtTime(1300, now + 0.1);
          gain.gain.setValueAtTime(0.05, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
          osc.start(now);
          osc.stop(now + 0.1);
          break;
        case "levelup":
          // Cheerful ascending arpeggio
          const notes = [440, 554.37, 659.25, 880];
          notes.forEach((freq, idx) => {
            const toneOsc = ctx.createOscillator();
            const toneGain = ctx.createGain();
            toneOsc.connect(toneGain);
            toneGain.connect(ctx.destination);
            toneOsc.frequency.setValueAtTime(freq, now + idx * 0.08);
            toneGain.gain.setValueAtTime(0.1, now + idx * 0.08);
            toneGain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.15);
            toneOsc.start(now + idx * 0.08);
            toneOsc.stop(now + idx * 0.08 + 0.15);
          });
          break;
        case "upgrade":
          osc.type = "triangle";
          osc.frequency.setValueAtTime(523.25, now); // C5
          osc.frequency.setValueAtTime(783.99, now + 0.1); // G5
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
          osc.start(now);
          osc.stop(now + 0.25);
          break;
        case "revive":
          // High synth sweep
          osc.type = "sine";
          osc.frequency.setValueAtTime(200, now);
          osc.frequency.exponentialRampToValueAtTime(1600, now + 0.5);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
          osc.start(now);
          osc.stop(now + 0.5);
          break;
        case "ad":
          // Happy commercial jingle
          [392, 523.25, 659.25, 783.99].forEach((f, idx) => {
            const jOsc = ctx.createOscillator();
            const jGain = ctx.createGain();
            jOsc.connect(jGain);
            jGain.connect(ctx.destination);
            jOsc.frequency.setValueAtTime(f, now + idx * 0.1);
            jGain.gain.setValueAtTime(0.08, now + idx * 0.1);
            jGain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.1 + 0.2);
            jOsc.start(now + idx * 0.1);
            jOsc.stop(now + idx * 0.1 + 0.2);
          });
          break;
        case "gameover":
          // Melodramatic minor chord fall
          const baseNotes = [293.66, 349.23, 440]; // D minor
          baseNotes.forEach((f, idx) => {
            const gOsc = ctx.createOscillator();
            const gGain = ctx.createGain();
            gOsc.connect(gGain);
            gGain.connect(ctx.destination);
            gOsc.frequency.setValueAtTime(f, now);
            gOsc.frequency.linearRampToValueAtTime(f * 0.5, now + 0.6);
            gGain.gain.setValueAtTime(0.12, now);
            gGain.gain.exponentialRampToValueAtTime(0.005, now + 0.6);
            gOsc.start(now);
            gOsc.stop(now + 0.6);
          });
          break;
      }
    } catch (e) {
      console.warn("Audio Context Error", e);
    }
  };

  // Toggle Mute Helper
  const toggleMute = () => {
    setIsMuted((prev: boolean) => {
      const next = !prev;
      localStorage.setItem("pioneer_muted", JSON.stringify(next));
      return next;
    });
  };

  // ==========================================
  // INITIAL GAME SETUP & RESIZING
  // ==========================================
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      }
    };

    if (gameState === "PLAYING") {
      handleResize();
      window.addEventListener("resize", handleResize);
    }
    return () => window.removeEventListener("resize", handleResize);
  }, [gameState]);

  // Handle Keyboard Input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"].includes(k) || ["arrowup", "arrowleft", "arrowdown", "arrowright"].includes(e.key.toLowerCase())) {
        const keyMap = engineRef.current.keys as any;
        if (k in keyMap) keyMap[k] = true;
        if (e.key in keyMap) keyMap[e.key] = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const keyMap = engineRef.current.keys as any;
      if (k in keyMap) keyMap[k] = false;
      if (e.key in keyMap) keyMap[e.key] = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // ==========================================
  // GAME START / INITIALIZATION FUNCTION
  // ==========================================
  const startNewGame = () => {
    initAudio();
    setHasRevivedThisRun(false);
    setDoubleGoldApplied(false);

    // Apply permanent stats from shop
    const baseMaxHp = 100 + shopUpgrades.health * 15;
    const baseSpeed = 1.8 + shopUpgrades.speed * 0.18;
    const baseDamage = 1.0 + shopUpgrades.damage * 0.15;
    const baseMagnet = 100 + shopUpgrades.magnet * 25;
    const baseRegen = shopUpgrades.regen * 0.35;

    // Reset Engine Ref
    engineRef.current = {
      player: {
        x: 0,
        y: 0,
        hp: baseMaxHp,
        maxHp: baseMaxHp,
        level: 1,
        xp: 0,
        xpNeeded: 50,
        gold: 0,
        kills: 0,
        speed: baseSpeed,
        magnetRange: baseMagnet,
        damageMultiplier: baseDamage,
        regenRate: baseRegen,
        size: 14,
      },
      weapons: [
        { id: "plasma_gun", name: "Plasma Cannon", level: 1, timer: 0, maxTimer: 60 }
      ],
      enemies: [],
      projectiles: [],
      items: [],
      particles: [],
      damageTexts: [],
      keys: {
        w: false, a: false, s: false, d: false,
        ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false,
      },
      joystick: {
        active: false,
        startX: 0,
        startY: 0,
        curX: 0,
        curY: 0,
      },
      gameTime: 0,
      spawnTimer: 0,
      isPaused: false,
      bossSpawned: false,
      shieldAngle: 0,
      lastFrameTime: performance.now(),
    };

    setGameState("PLAYING");
    setIsLevelUp(false);
    setGameStats({
      time: "00:00",
      kills: 0,
      gold: 0,
      level: 1,
      xpPercent: 0,
      hpPercent: 100,
    });
  };

  // ==========================================
  // WEAPON FIRE BEHAVIOR HANDLER
  // ==========================================
  const fireWeapon = (wpn: Weapon, player: any, enemies: Enemy[], projectiles: Projectile[]) => {
    // Targets the nearest enemy
    if (enemies.length === 0) return;

    let nearestEnemy: Enemy | null = null;
    let nearestDist = Infinity;

    enemies.forEach((enemy) => {
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEnemy = enemy;
      }
    });

    if (!nearestEnemy) return;

    const target: Enemy = nearestEnemy;
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const vx = (dx / dist) * 6; // bullet speed
    const vy = (dy / dist) * 6;

    const baseDmg = 12 * player.damageMultiplier;

    if (wpn.id === "plasma_gun") {
      playSfx("shoot");
      if (wpn.level === 1) {
        projectiles.push({ x: player.x, y: player.y, vx, vy, damage: baseDmg, size: 4, color: "#38bdf8", pierce: 1 });
      } else if (wpn.level === 2) {
        // Double shots slightly angled
        projectiles.push({ x: player.x, y: player.y, vx: vx * 0.98 - vy * 0.05, vy: vy * 0.98 + vx * 0.05, damage: baseDmg, size: 4, color: "#38bdf8", pierce: 1 });
        projectiles.push({ x: player.x, y: player.y, vx: vx * 0.98 + vy * 0.05, vy: vy * 0.98 - vx * 0.05, damage: baseDmg, size: 4, color: "#38bdf8", pierce: 1 });
      } else if (wpn.level === 3) {
        // High Damage Heavy shots
        projectiles.push({ x: player.x, y: player.y, vx: vx * 1.2, vy: vy * 1.2, damage: baseDmg * 1.5, size: 6, color: "#facc15", pierce: 1 });
      } else if (wpn.level === 4) {
        // 3 spread shot
        projectiles.push({ x: player.x, y: player.y, vx, vy, damage: baseDmg, size: 4, color: "#38bdf8", pierce: 1 });
        projectiles.push({ x: player.x, y: player.y, vx: vx * 0.92 - vy * 0.15, vy: vy * 0.92 + vx * 0.15, damage: baseDmg, size: 4, color: "#38bdf8", pierce: 1 });
        projectiles.push({ x: player.x, y: player.y, vx: vx * 0.92 + vy * 0.15, vy: vy * 0.92 - vx * 0.15, damage: baseDmg, size: 4, color: "#38bdf8", pierce: 1 });
      } else {
        // Max Level Hyper Plasma (Pierces)
        projectiles.push({ x: player.x, y: player.y, vx: vx * 1.3, vy: vy * 1.3, damage: baseDmg * 1.8, size: 7, color: "#a855f7", pierce: 3 });
      }
    }

    if (wpn.id === "lightning_rod") {
      // Periodic Lightning targets random enemies
      const strikeCount = wpn.level >= 4 ? 4 : wpn.level >= 2 ? 2 : 1;
      const damage = (30 + wpn.level * 15) * player.damageMultiplier;
      const splash = wpn.level >= 3;

      for (let i = 0; i < strikeCount; i++) {
        if (enemies.length === 0) break;
        const index = Math.floor(Math.random() * enemies.length);
        const tgt = enemies[index];
        playSfx("hit");

        // Flash and strike on canvas coordinates inside the loop
        // Deal damage immediately
        tgt.hp -= damage;
        engineRef.current.damageTexts.push({
          x: tgt.x,
          y: tgt.y - 10,
          text: `${Math.round(damage)}⚡`,
          color: "#e0f2fe",
          alpha: 1,
          vy: -1.5
        });

        // Add splash damage
        if (splash) {
          enemies.forEach((other) => {
            if (other.id !== tgt.id) {
              const dxo = other.x - tgt.x;
              const dyo = other.y - tgt.y;
              const disto = Math.sqrt(dxo * dxo + dyo * dyo);
              if (disto < 75) {
                const splashDmg = damage * 0.5;
                other.hp -= splashDmg;
                engineRef.current.damageTexts.push({
                  x: other.x,
                  y: other.y - 8,
                  text: `${Math.round(splashDmg)}`,
                  color: "#93c5fd",
                  alpha: 1,
                  vy: -1.2
                });
              }
            }
          });
        }

        // Spawn strike sparks
        for (let s = 0; s < 12; s++) {
          engineRef.current.particles.push({
            x: tgt.x,
            y: tgt.y,
            vx: (Math.random() - 0.5) * 5,
            vy: (Math.random() - 0.5) * 5,
            color: "#60a5fa",
            size: 2 + Math.random() * 2,
            alpha: 1,
            decay: 0.05 + Math.random() * 0.04
          });
        }
      }
    }

    if (wpn.id === "quantum_wave") {
      // Expand shockwave pulse from center
      const radius = 100 + wpn.level * 25;
      const dmg = (15 + wpn.level * 8) * player.damageMultiplier;
      const knockbackForce = wpn.level >= 3 ? 6 : 4;
      playSfx("shoot");

      enemies.forEach((e) => {
        const dx = e.x - player.x;
        const dy = e.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          e.hp -= dmg;
          // Apply push back
          const angle = Math.atan2(dy, dx);
          e.x += Math.cos(angle) * knockbackForce;
          e.y += Math.sin(angle) * knockbackForce;

          engineRef.current.damageTexts.push({
            x: e.x,
            y: e.y - 12,
            text: `${Math.round(dmg)}`,
            color: "#22d3ee",
            alpha: 1,
            vy: -1.0
          });
        }
      });

      // Spawn concentric pulse visual rings
      for (let p = 0; p < 3; p++) {
        setTimeout(() => {
          if (gameState !== "PLAYING" || engineRef.current.isPaused) return;
          // Spawn cosmetic expanding wave particle ring in frame
          for (let r = 0; r < 24; r++) {
            const angle = (r / 24) * Math.PI * 2;
            engineRef.current.particles.push({
              x: player.x,
              y: player.y,
              vx: Math.cos(angle) * (radius / 15),
              vy: Math.sin(angle) * (radius / 15),
              color: "rgba(34, 211, 238, 0.4)",
              size: 3,
              alpha: 0.8,
              decay: 0.04
            });
          }
        }, p * 120);
      }
    }
  };

  // ==========================================
  // LEVEL UP UPGRADE RANDOMIZER
  // ==========================================
  const triggerLevelUp = () => {
    engineRef.current.isPaused = true;
    playSfx("levelup");

    // Form upgrade choices
    const options: UpgradeOption[] = [];
    const playerWeapons = engineRef.current.weapons;

    // Helper to get active weapon level
    const getLevel = (id: string) => playerWeapons.find((w) => w.id === id)?.level || 0;

    // Upgrades Pool
    const pool = [
      { id: "plasma_gun", name: "Plasma Cannon", desc: "Autofires high-velocity plasma bolts targeting nearest foes.", icon: <Flame className="w-6 h-6 text-sky-400" />, type: "weapon" as const },
      { id: "nanoshield", name: "Nano-Orbit Shield", desc: "Energy orbs rotate around you, tearing down contacting threats.", icon: <Shield className="w-6 h-6 text-emerald-400" />, type: "weapon" as const },
      { id: "quantum_wave", name: "Quantum Nova", desc: "Fires expanding gravity pulses to damage and knock back swarms.", icon: <Zap className="w-6 h-6 text-cyan-400" />, type: "weapon" as const },
      { id: "lightning_rod", name: "Tesla Strike", desc: "Calls high-voltage electric discharges striking random invaders.", icon: <Sparkles className="w-6 h-6 text-violet-400" />, type: "weapon" as const },
      { id: "stat_dmg", name: "Damage Accelerator", desc: "Supercharges weapon reactors, increasing damage output by +15%.", icon: <Zap className="w-6 h-6 text-amber-400" />, type: "stat" as const },
      { id: "stat_speed", name: "Thruster Overclock", desc: "Improves structural propulsion systems, boosting speed by +12%.", icon: <Activity className="w-6 h-6 text-rose-400" />, type: "stat" as const },
      { id: "stat_magnet", name: "Quantum Harvester", desc: "Overclocks electromagnetic pickup matrix for items by +25%.", icon: <Sparkles className="w-6 h-6 text-fuchsia-400" />, type: "stat" as const },
      { id: "stat_heal", name: "Micro-Repair Bots", desc: "Injects nanite streams that passively regenerate +0.5 HP/sec.", icon: <Heart className="w-6 h-6 text-green-400" />, type: "stat" as const },
    ];

    // Pick 3 random, relevant upgrades
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const selected = shuffled.filter((item) => {
      if (item.type === "weapon") {
        const lvl = getLevel(item.id);
        return lvl < 5; // Allow unlocking or leveling up up to 5
      }
      return true;
    }).slice(0, 3);

    const formatted: UpgradeOption[] = selected.map((item) => {
      const curLvl = getLevel(item.id);
      return {
        id: item.id,
        name: curLvl > 0 ? `${item.name} (Lv. ${curLvl + 1})` : `Unlock ${item.name}`,
        desc: item.desc,
        icon: item.icon,
        level: curLvl,
        type: item.type,
      };
    });

    setLevelUpOptions(formatted);
    setIsLevelUp(true);
  };

  const applyUpgrade = (opt: UpgradeOption) => {
    const engine = engineRef.current;
    playSfx("upgrade");

    if (opt.type === "weapon") {
      const existing = engine.weapons.find((w) => w.id === opt.id);
      if (existing) {
        existing.level += 1;
      } else {
        // Unlock new weapon
        let maxTimer = 60;
        if (opt.id === "lightning_rod") maxTimer = 150;
        if (opt.id === "quantum_wave") maxTimer = 220;
        if (opt.id === "nanoshield") maxTimer = 999999; // passive updater

        engine.weapons.push({ id: opt.id, name: opt.name, level: 1, timer: 0, maxTimer });
      }
    } else {
      // Stat Upgrades
      if (opt.id === "stat_dmg") engine.player.damageMultiplier += 0.15;
      if (opt.id === "stat_speed") engine.player.speed += 0.18;
      if (opt.id === "stat_magnet") engine.player.magnetRange += 25;
      if (opt.id === "stat_heal") {
        engine.player.regenRate += 0.5;
        engine.player.hp = Math.min(engine.player.hp + 20, engine.player.maxHp);
      }
    }

    // Resume loop
    engine.isPaused = false;
    setIsLevelUp(false);
  };

  // ==========================================
  // AD MONETIZATION INTEGRATIONS (MOCK)
  // ==========================================
  const triggerAdFlow = (
    type: "REROLL" | "REVIVE" | "DOUBLE_GOLD",
    title: string,
    onReward: () => void
  ) => {
    playSfx("ad");
    engineRef.current.isPaused = true;

    setAdState({
      visible: true,
      type,
      timer: 1.5, // 1.5-second high-energy simulated ad
      title,
    });

    const interval = setInterval(() => {
      setAdState((prev) => {
        if (prev.timer <= 0.1) {
          clearInterval(interval);
          setTimeout(() => {
            setAdState({ visible: false, type: null, timer: 0, title: "" });
            onReward();
          }, 300);
          return { ...prev, timer: 0 };
        }
        return { ...prev, timer: prev.timer - 0.1 };
      });
    }, 100);
  };

  const handleRerollAd = () => {
    // showRerollAd() console stub and full game interaction
    console.log("showRerollAd(): Dispatching interactive video ad to reshuffle game cards");
    triggerAdFlow("REROLL", "Reshuffling Skill Cards...", () => {
      const pool = [
        { id: "plasma_gun", name: "Plasma Cannon", desc: "Autofires high-velocity plasma bolts targeting nearest foes.", icon: <Flame className="w-6 h-6 text-sky-400" />, type: "weapon" as const },
        { id: "nanoshield", name: "Nano-Orbit Shield", desc: "Energy orbs rotate around you, tearing down contacting threats.", icon: <Shield className="w-6 h-6 text-emerald-400" />, type: "weapon" as const },
        { id: "quantum_wave", name: "Quantum Nova", desc: "Fires expanding gravity pulses to damage and knock back swarms.", icon: <Zap className="w-6 h-6 text-cyan-400" />, type: "weapon" as const },
        { id: "lightning_rod", name: "Tesla Strike", desc: "Calls high-voltage electric discharges striking random invaders.", icon: <Sparkles className="w-6 h-6 text-violet-400" />, type: "weapon" as const },
        { id: "stat_dmg", name: "Damage Accelerator", desc: "Supercharges weapon reactors, increasing damage output by +15%.", icon: <Zap className="w-6 h-6 text-amber-400" />, type: "stat" as const },
        { id: "stat_speed", name: "Thruster Overclock", desc: "Improves structural propulsion systems, boosting speed by +12%.", icon: <Activity className="w-6 h-6 text-rose-400" />, type: "stat" as const },
        { id: "stat_magnet", name: "Quantum Harvester", desc: "Overclocks electromagnetic pickup matrix for items by +25%.", icon: <Sparkles className="w-6 h-6 text-fuchsia-400" />, type: "stat" as const },
        { id: "stat_heal", name: "Micro-Repair Bots", desc: "Injects nanite streams that passively regenerate +0.5 HP/sec.", icon: <Heart className="w-6 h-6 text-green-400" />, type: "stat" as const },
      ];

      const playerWeapons = engineRef.current.weapons;
      const getLvl = (id: string) => playerWeapons.find((w) => w.id === id)?.level || 0;

      // Pick 3 random, unique, relevant upgrades
      const shuffled = [...pool].sort(() => 0.5 - Math.random());
      const selected = shuffled.filter((item) => {
        if (item.type === "weapon") {
          const lvl = getLvl(item.id);
          return lvl < 5; // Allow unlocking or leveling up up to 5
        }
        return true;
      }).slice(0, 3);

      const randomUpgrades: UpgradeOption[] = selected.map((item) => {
        const curLvl = getLvl(item.id);
        return {
          id: item.id,
          name: curLvl > 0 ? `${item.name} (Lv. ${curLvl + 1})` : `Unlock ${item.name}`,
          desc: item.desc,
          icon: item.icon,
          level: curLvl,
          type: item.type,
        };
      });

      setLevelUpOptions(randomUpgrades);
      engineRef.current.isPaused = true;
    });
  };

  const handleReviveAd = () => {
    // showReviveAd() console stub and full game interaction
    console.log("showReviveAd(): Displaying high-impact video ad. Restoring spaceship core to 50% HP!");
    triggerAdFlow("REVIVE", "System Re-Initialization...", () => {
      const engine = engineRef.current;
      setHasRevivedThisRun(true);
      engine.player.hp = Math.floor(engine.player.maxHp * 0.5);

      // Clear adjacent enemies for safety with blast wave
      engine.enemies = [];
      engine.projectiles = [];

      // Create a gorgeous massive star particle explosion
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        const spd = 5 + Math.random() * 8;
        engine.particles.push({
          x: engine.player.x,
          y: engine.player.y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          color: "#22c55e",
          size: 4 + Math.random() * 3,
          alpha: 1,
          decay: 0.02
        });
      }

      playSfx("revive");
      setGameState("PLAYING");
      engine.isPaused = false;
      engine.lastFrameTime = performance.now();
    });
  };

  const handleDoubleGoldAd = () => {
    // showDoubleGoldAd() console stub and full game interaction
    console.log("showDoubleGoldAd(): Video ad playback success. Doubling extracted gold reserves!");
    triggerAdFlow("DOUBLE_GOLD", "Doubling Gold Loot...", () => {
      setDoubleGoldApplied(true);
      setFinalStats((prev) => {
        const addedGold = prev.gold;
        const doubledGold = prev.gold * 2;
        // Credit the double gold permanently to currency
        setMetaGold((g) => {
          const next = g + addedGold;
          localStorage.setItem("pioneer_meta_gold", next.toString());
          return next;
        });
        return {
          ...prev,
          gold: doubledGold,
          unlockedGold: prev.unlockedGold + addedGold
        };
      });
      playSfx("levelup");
    });
  };

  // ==========================================
  // PERMANENT META UPGRADE SHOP HANDLERS
  // ==========================================
  const handlePiAuth = async (force = false) => {
    if (typeof window === "undefined" || !(window as any).Pi) {
      console.log("[Pi SDK] Pi SDK not available.");
      return;
    }
    const Pi = (window as any).Pi;
    
    // Dynamic sandbox detection to support local testing & live production deployments in Pi Browser
    const getSandboxMode = () => {
      const envSandbox = (import.meta as any).env?.VITE_PI_SANDBOX;
      if (envSandbox === "true") return true;
      if (envSandbox === "false") return false;

      if (typeof window !== "undefined") {
        const hostname = window.location.hostname;
        if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168.")) {
          return true;
        }
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get("sandbox") === "true") return true;
        if (urlParams.get("sandbox") === "false") return false;
        
        try {
          if (window.self !== window.top) {
            const referrer = document.referrer;
            if (referrer && referrer.includes("sandbox.minepi.com")) {
              return true;
            }
          }
        } catch (e) {
          return true;
        }
      }
      return false;
    };
    const sandboxMode = getSandboxMode();

    if (force) {
      (window as any).__piAuthenticating = false;
    }

    if ((window as any).__piAuthenticating) {
      console.log("[Pi SDK] Authentication is already in progress, skipping duplicate call.");
      return;
    }

    (window as any).__piAuthenticating = true;
    
    if ((window as any).__setPiPaymentStatus) (window as any).__setPiPaymentStatus("authenticating");
    else setPiPaymentStatus("authenticating");

    if ((window as any).__setPiPaymentError) (window as any).__setPiPaymentError("");
    else setPiPaymentError("");

    try {
      // 1. Ensure Pi.init is treated as a Promise and fully awaited
      if (!(window as any).__piInitialized) {
        console.log(`[Pi SDK] Initializing Pi SDK in ${sandboxMode ? "sandbox" : "production"} mode...`);
        await Pi.init({ version: "2.0", sandbox: sandboxMode });
        (window as any).__piInitialized = true;
        console.log("[Pi SDK] Pi SDK Initialized successfully.");
      } else {
        console.log("[Pi SDK] Pi SDK already initialized.");
      }

      // Force Pi payment mode by default
      if ((window as any).__setPayWithPiMode) (window as any).__setPayWithPiMode(true);
      else setPayWithPiMode(true);

      // 2. Perform Pi.authenticate using the 'username' scope and handle incomplete payments
      console.log("[Pi SDK] Initiating Pi.authenticate...");
      const auth = await Pi.authenticate(["username", "payments"], (incompletePayment: any) => {
        console.log("[Pi SDK] Incomplete payment found:", incompletePayment);
        fetch("/api/pi/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentId: incompletePayment.identifier,
            txid: incompletePayment.transaction?.txid,
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            console.log("[Pi SDK] Incomplete payment resolved:", data);
          })
          .catch((err) => {
            console.warn("[Pi SDK] Failed to resolve incomplete payment:", err);
          });
      });

      console.log("[Pi SDK] Client authentication successful. Verifying token on backend...", auth);

      // 3. Send access token to backend for authorization check (v2/me)
      let validatedUser = auth.user;
      try {
        const res = await fetch("/api/pi/authenticate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ accessToken: auth.accessToken }),
        });

        const contentType = res.headers.get("content-type");
        const isJson = contentType && contentType.includes("application/json");

        if (!res.ok) {
          let errorMsg = "Backend token validation failed";
          if (isJson) {
            const errorData = await res.json();
            errorMsg = errorData.error || errorMsg;
          } else {
            console.warn("[Pi SDK] Backend returned HTML error/404 page. Using client fallback.");
            // Do not throw, we want to proceed with client-side fallback
          }
        } else {
          if (isJson) {
            const backendData = await res.json();
            console.log("[Pi SDK] Backend verification succeeded. Established session for user:", backendData.user);
            validatedUser = backendData.user || auth.user;
          } else {
            console.warn("[Pi SDK] Backend did not return JSON. Falling back to client-side auth details.");
          }
        }
      } catch (backendErr: any) {
        console.warn("[Pi SDK] Backend verification warning (using fallback client auth):", backendErr);
      }

      // Store globally to retain state across mounts/StrictMode re-renders
      (window as any).__piUser = validatedUser;
      (window as any).__piAuthenticated = true;
      (window as any).__piAuthenticating = false;

      // Dispatch to state setters
      if ((window as any).__setPiUser) (window as any).__setPiUser(validatedUser);
      else setPiUser(validatedUser);

      if ((window as any).__setPiAuthenticated) (window as any).__setPiAuthenticated(true);
      else setPiAuthenticated(true);

      if ((window as any).__setPayWithPayWithPiMode) (window as any).__setPayWithPayWithPiMode(true);
      else if ((window as any).__setPayWithPiMode) (window as any).__setPayWithPiMode(true);
      else setPayWithPiMode(true);

      if ((window as any).__setPiPaymentStatus) (window as any).__setPiPaymentStatus("idle");
      else setPiPaymentStatus("idle");
    } catch (err: any) {
      console.warn("[Pi SDK] Authentication workflow failed:", err);
      (window as any).__piAuthenticating = false;

      const errMsg = err?.message || String(err);
      if ((window as any).__setPiPaymentError) (window as any).__setPiPaymentError(errMsg);
      else setPiPaymentError(errMsg);

      if ((window as any).__setPiPaymentStatus) (window as any).__setPiPaymentStatus("idle");
      else setPiPaymentStatus("idle");
    }
  };

  useEffect(() => {
    // 1. Fetch backend configuration status
    fetch("/api/pi/status")
      .then((res) => {
        if (!res.ok) throw new Error("Status API returned non-200");
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          return res.json();
        }
        throw new Error("Response was not JSON (probably HTML or 404 page)");
      })
      .then((data) => {
        if (data && typeof data.configured === "boolean") {
          const setter = (window as any).__setPiApiKeyConfigured || setPiApiKeyConfigured;
          setter(data.configured);
        }
      })
      .catch((err) => {
        console.warn("[Pi SDK] Failed to fetch backend status safely:", err);
        const setter = (window as any).__setPiApiKeyConfigured || setPiApiKeyConfigured;
        setter(false);
      });

    // 2. Handle Pi SDK Auto-auth
    if (typeof window !== "undefined" && (window as any).Pi) {
      // If we are already authenticated and have user data globally, restore it
      if ((window as any).__piAuthenticated && (window as any).__piUser) {
        console.log("[Pi SDK] Restoring existing authenticated session:", (window as any).__piUser.username);
        setPiUser((window as any).__piUser);
        setPiAuthenticated(true);
        setPayWithPiMode(true);
        setPiPaymentStatus("idle");
      } else {
        // Automatically trigger authentication on load
        handlePiAuth();
      }
    }
  }, []);

  const buyShopUpgrade = (key: keyof typeof shopUpgrades, cost: number) => {
    if (shopUpgrades[key] >= 5) return;

    if (payWithPiMode && (window as any).Pi) {
      const piAmount = parseFloat((cost * 0.001).toFixed(4));
      setPiPaymentStatus("creating");
      setPiPaymentError("");

      try {
        const Pi = (window as any).Pi;
        Pi.createPayment(
          {
            amount: piAmount,
            memo: `Pioneer Upgrade: ${key === "damage" ? "Plasma Accelerators" : key === "health" ? "Nanoshield Armor" : key === "speed" ? "Reactor Thrusters" : key === "magnet" ? "Quantum Harvester" : "Nanite Repair Systems"} (Level ${shopUpgrades[key] + 1})`,
            metadata: { upgradeKey: key, targetLevel: shopUpgrades[key] + 1 },
          },
          {
            onReadyForServerApproval: (paymentId: string) => {
              console.log(`[Pi SDK] Payment ${paymentId} ready for server approval...`);
              setPiPaymentStatus("approving");
              
              fetch("/api/pi/approve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paymentId }),
              })
                .then((res) => {
                  if (!res.ok) throw new Error("Approval server endpoint returned non-200");
                  const contentType = res.headers.get("content-type");
                  if (contentType && contentType.includes("application/json")) {
                    return res.json();
                  }
                  throw new Error("Không thể kết nối Backend Server (Nhận phản hồi HTML thay vì JSON). Bạn có đang chạy trên Vercel không? Hãy đổi sang chế độ '¢ Credits' ở trên để nâng cấp.");
                })
                .then((data) => {
                  console.log("[Pi SDK] Server approved payment successfully:", data);
                })
                .catch((err: any) => {
                  console.warn("[Pi SDK] Server approval failed:", err);
                  setPiPaymentStatus("error");
                  setPiPaymentError(err?.message || "Failed to approve payment with the server.");
                });
            },
            onReadyForServerCompletion: (paymentId: string, txid: string) => {
              console.log(`[Pi SDK] Payment ${paymentId} signed on blockchain, ready for completion...`);
              setPiPaymentStatus("completing");

              fetch("/api/pi/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paymentId, txid }),
              })
                .then((res) => {
                  if (!res.ok) throw new Error("Completion server endpoint returned non-200");
                  const contentType = res.headers.get("content-type");
                  if (contentType && contentType.includes("application/json")) {
                    return res.json();
                  }
                  throw new Error("Không thể kết nối Backend Server (Nhận phản hồi HTML thay vì JSON).");
                })
                .then((data) => {
                  console.log("[Pi SDK] Server completed payment successfully:", data);
                  
                  // Grant upgrade in client state
                  setShopUpgrades((prev: any) => {
                    const next = { ...prev, [key]: prev[key] + 1 };
                    localStorage.setItem("pioneer_shop_upgrades", JSON.stringify(next));
                    return next;
                  });
                  
                  playSfx("upgrade");
                  setPiPaymentStatus("success");
                  
                  // Clear success state after 3 seconds
                  setTimeout(() => setPiPaymentStatus("idle"), 3000);
                })
                .catch((err) => {
                  console.warn("[Pi SDK] Server completion failed:", err);
                  setPiPaymentStatus("error");
                  setPiPaymentError("Blockchain transaction was made but backend completion failed.");
                });
            },
            onCancel: (paymentId: string) => {
              console.log("[Pi SDK] Payment cancelled by user:", paymentId);
              setPiPaymentStatus("cancelled");
              setTimeout(() => setPiPaymentStatus("idle"), 2500);
            },
            onError: (error: Error, payment: any) => {
              console.warn("[Pi SDK] Payment error:", error, payment);
              setPiPaymentStatus("error");
              setPiPaymentError(error.message || "An unexpected error occurred during checkout.");
              setTimeout(() => setPiPaymentStatus("idle"), 4000);
            }
          }
        );
      } catch (err: any) {
        console.warn("[Pi SDK] Error launching payment flow:", err);
        setPiPaymentStatus("error");
        setPiPaymentError(err.message || "Could not launch Pi payment interface.");
        setTimeout(() => setPiPaymentStatus("idle"), 3000);
      }
    } else {
      // Standard local gold upgrade
      if (metaGold >= cost) {
        setMetaGold((prev) => {
          const next = prev - cost;
          localStorage.setItem("pioneer_meta_gold", next.toString());
          return next;
        });

        setShopUpgrades((prev: any) => {
          const next = { ...prev, [key]: prev[key] + 1 };
          localStorage.setItem("pioneer_shop_upgrades", JSON.stringify(next));
          return next;
        });

        playSfx("upgrade");
      }
    }
  };

  const buyCoinsWithPi = (amountCoins: number, piAmount: number) => {
    if (payWithPiMode && (window as any).Pi) {
      setPiPaymentType("buy");
      setPiPaymentStatus("creating");
      setPiPaymentError("");

      try {
        const Pi = (window as any).Pi;
        Pi.createPayment(
          {
            amount: piAmount,
            memo: `Mua ${amountCoins} Xu (Base Engineering Credits) trong game Pioneer`,
            metadata: { type: "buy_xu", amountCoins },
          },
          {
            onReadyForServerApproval: (paymentId: string) => {
              console.log(`[Pi SDK] Buy Xu payment ${paymentId} ready for server approval...`);
              setPiPaymentStatus("approving");
              
              fetch("/api/pi/approve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paymentId }),
              })
                .then((res) => {
                  if (!res.ok) throw new Error("Approval server endpoint returned non-200");
                  const contentType = res.headers.get("content-type");
                  if (contentType && contentType.includes("application/json")) {
                    return res.json();
                  }
                  throw new Error("Không thể kết nối Backend Server (Nhận phản hồi HTML thay vì JSON).");
                })
                .then((data) => {
                  console.log("[Pi SDK] Server approved Buy Xu payment successfully:", data);
                })
                .catch((err: any) => {
                  console.warn("[Pi SDK] Server approval for Buy Xu failed:", err);
                  setPiPaymentStatus("error");
                  setPiPaymentError(err?.message || "Phê duyệt thanh toán từ Server thất bại.");
                });
            },
            onReadyForServerCompletion: (paymentId: string, txid: string) => {
              console.log(`[Pi SDK] Buy Xu payment ${paymentId} signed, ready for completion...`);
              setPiPaymentStatus("completing");

              fetch("/api/pi/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paymentId, txid }),
              })
                .then((res) => {
                  if (!res.ok) throw new Error("Completion server endpoint returned non-200");
                  const contentType = res.headers.get("content-type");
                  if (contentType && contentType.includes("application/json")) {
                    return res.json();
                  }
                  throw new Error("Không thể kết nối Backend Server (Nhận phản hồi HTML thay vì JSON).");
                })
                .then((data) => {
                  console.log("[Pi SDK] Server completed Buy Xu payment successfully:", data);
                  
                  // Grant coins
                  setMetaGold((prev: number) => {
                    const next = prev + amountCoins;
                    localStorage.setItem("pioneer_meta_gold", String(next));
                    return next;
                  });
                  
                  playSfx("upgrade");
                  setPiPaymentStatus("success");
                  
                  setTimeout(() => setPiPaymentStatus("idle"), 3000);
                })
                .catch((err) => {
                  console.warn("[Pi SDK] Server completion for Buy Xu failed:", err);
                  setPiPaymentStatus("error");
                  setPiPaymentError("Hoàn thành thanh toán từ Server thất bại.");
                });
            },
            onCancel: (paymentId: string) => {
              console.log(`[Pi SDK] Buy Xu payment ${paymentId} cancelled by user.`);
              setPiPaymentStatus("cancelled");
              setTimeout(() => setPiPaymentStatus("idle"), 2500);
            },
            onError: (error: Error, payment?: any) => {
              console.error("[Pi SDK] Buy Xu payment error:", error, payment);
              setPiPaymentStatus("error");
              setPiPaymentError(error?.message || "Lỗi giao dịch.");
              setTimeout(() => setPiPaymentStatus("idle"), 4000);
            }
          }
        );
      } catch (err: any) {
        console.warn("[Pi SDK] Failed to buy xu:", err);
        setPiPaymentStatus("error");
        setPiPaymentError(err?.message || "Lỗi khởi tạo giao dịch.");
        setTimeout(() => setPiPaymentStatus("idle"), 3000);
      }
    } else {
      // Local/Sandbox Mode purchase of xu
      setPiPaymentStatus("creating");
      setTimeout(() => {
        setMetaGold((prev: number) => {
          const next = prev + amountCoins;
          localStorage.setItem("pioneer_meta_gold", String(next));
          return next;
        });
        setPiPaymentStatus("success");
        setTimeout(() => setPiPaymentStatus("idle"), 2000);
      }, 500);
    }
  };

  const sellCoinsForPi = async (amountCoins: number, piAmount: number) => {
    if (metaGold < amountCoins) {
      setPiPaymentError(`Bạn không đủ xu để bán (Cần tối thiểu ${amountCoins} xu)`);
      return;
    }

    if (!piUser) {
      setPiPaymentError("Vui lòng đăng nhập ví Pi trước khi bán xu.");
      return;
    }

    setPiPaymentType("sell");
    setPiPaymentStatus("creating");
    setPiPaymentError("");

    try {
      console.log(`[Pi SDK] Requesting backend to transfer ${piAmount} π in exchange for ${amountCoins} xu...`);
      const res = await fetch("/api/pi/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: piUser.uid,
          username: piUser.username,
          amountCoins: amountCoins,
          piAmount: piAmount
        }),
      });

      const contentType = res.headers.get("content-type");
      const isJson = contentType && contentType.includes("application/json");

      if (!res.ok) {
        let errorMsg = "Giao dịch bán xu bị từ chối từ Server.";
        if (isJson) {
          const errorData = await res.json();
          errorMsg = errorData.error || errorMsg;
        } else {
          errorMsg = "Không thể kết nối Backend Server (Nhận phản hồi HTML thay vì JSON). Vui lòng cấu hình Backend Server.";
        }
        throw new Error(errorMsg);
      }

      if (isJson) {
        const data = await res.json();
        console.log("[Pi SDK] Backend sell response:", data);

        // Deduct coins in client
        setMetaGold((prev: number) => {
          const next = Math.max(0, prev - amountCoins);
          localStorage.setItem("pioneer_meta_gold", String(next));
          return next;
        });

        playSfx("upgrade");
        
        if (data.simulated) {
          setPiPaymentStatus("success");
          setPiPaymentError(`[MÔ PHỎNG] ${piAmount} π (Chưa cấu hình PI_WALLET_SEED trên Server)`);
        } else {
          setPiPaymentStatus("success");
          setPiPaymentError(`${piAmount} π`);
        }
      } else {
        throw new Error("Phản hồi không hợp lệ từ máy chủ.");
      }

      setTimeout(() => {
        setPiPaymentStatus("idle");
        setPiPaymentError("");
      }, 7000);
    } catch (err: any) {
      console.warn("[Pi SDK] Failed to sell xu:", err);
      setPiPaymentStatus("error");
      setPiPaymentError(err?.message || "Lỗi khi xử lý giao dịch bán xu.");
      setTimeout(() => setPiPaymentStatus("idle"), 4000);
    }
  };

  const resetSaveData = () => {
    if (confirm("Are you sure you want to reset all permanent stats, high scores, and gold?")) {
      localStorage.clear();
      setMetaGold(0);
      setShopUpgrades({ damage: 0, health: 0, speed: 0, magnet: 0, regen: 0 });
      setHighScores([]);
      playSfx("hurt");
    }
  };

  // ==========================================
  // MAIN CORE GAME loop (requestAnimationFrame)
  // ==========================================
  useEffect(() => {
    if (gameState !== "PLAYING") return;

    let animId: number;

    const gameLoop = (time: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const engine = engineRef.current;

      if (!canvas || !ctx) {
        animId = requestAnimationFrame(gameLoop);
        return;
      }

      // Delta Time calculation
      let dt = (time - engine.lastFrameTime) / 16.666; // Normalized around 60fps
      if (dt > 4) dt = 4; // Caps freeze gaps to prevent skips
      engine.lastFrameTime = time;

      if (engine.isPaused) {
        animId = requestAnimationFrame(gameLoop);
        return;
      }

      // 1. UPDATE TIMER & STATS
      engine.gameTime += (16.666 * dt) / 1000;
      const minutes = Math.floor(engine.gameTime / 60);
      const seconds = Math.floor(engine.gameTime % 60);
      const timeStr = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

      // 2. PASSIVE PLAYER STATS (REGEN)
      if (engine.player.regenRate > 0 && engine.player.hp < engine.player.maxHp) {
        const addedHp = (engine.player.regenRate * 16.666 * dt) / 1000;
        engine.player.hp = Math.min(engine.player.hp + addedHp, engine.player.maxHp);
      }

      // 3. PLAYER MOVEMENT INPUTS
      let dx = 0;
      let dy = 0;

      // Handle keyboard move velocity
      if (engine.keys.w || engine.keys.ArrowUp) dy -= 1;
      if (engine.keys.s || engine.keys.ArrowDown) dy += 1;
      if (engine.keys.a || engine.keys.ArrowLeft) dx -= 1;
      if (engine.keys.d || engine.keys.ArrowRight) dx += 1;

      // Handle virtual touch joystick velocity
      if (engine.joystick.active) {
        const jdx = engine.joystick.curX - engine.joystick.startX;
        const jdy = engine.joystick.curY - engine.joystick.startY;
        const jdist = Math.sqrt(jdx * jdx + jdy * jdy);
        if (jdist > 0) {
          const power = Math.min(jdist, 60) / 60;
          dx = (jdx / jdist) * power;
          dy = (jdy / jdist) * power;
        }
      }

      // Normalise direction
      const moveDist = Math.sqrt(dx * dx + dy * dy);
      if (moveDist > 0) {
        engine.player.x += (dx / (moveDist > 1 ? moveDist : 1)) * engine.player.speed * dt;
        engine.player.y += (dy / (moveDist > 1 ? moveDist : 1)) * engine.player.speed * dt;

        // Emit subtle jetpack exhaust particles
        if (Math.random() < 0.3 * dt) {
          engine.particles.push({
            x: engine.player.x - (dx / moveDist) * 10,
            y: engine.player.y - (dy / moveDist) * 10,
            vx: -(dx / moveDist) * 2 + (Math.random() - 0.5),
            vy: -(dy / moveDist) * 2 + (Math.random() - 0.5),
            color: Math.random() > 0.4 ? "#f97316" : "#ef4444",
            size: 2 + Math.random() * 2,
            alpha: 1,
            decay: 0.04
          });
        }
      }

      // Update passive Shield orbit angle
      engine.shieldAngle += 0.05 * dt;

      // 4. WEAPONS UPDATE
      engine.weapons.forEach((wpn) => {
        if (wpn.id === "nanoshield") return; // Render-only or calculated on ticks
        wpn.timer += dt;
        if (wpn.timer >= wpn.maxTimer) {
          wpn.timer = 0;
          fireWeapon(wpn, engine.player, engine.enemies, engine.projectiles);
        }
      });

      // 5. SPAWN SWARMS GRADUALLY IN CIRCLES
      engine.spawnTimer += dt;
      let spawnRate = Math.max(25, 80 - Math.floor(engine.gameTime * 0.4)); // gets faster and harder
      if (engine.spawnTimer >= spawnRate) {
        engine.spawnTimer = 0;

        // Decide type based on elapsed seconds
        let enemyType: Enemy["type"] = "drone";
        let hp = 15;
        let speed = 1.1;
        let size = 9;
        let color = "#ef4444"; // red drone
        let pts = 1;

        const roll = Math.random();
        if (engine.gameTime > 120 && roll < 0.15) {
          enemyType = "goliath";
          hp = 110;
          speed = 0.5;
          size = 18;
          color = "#3b82f6"; // blue giant tank
          pts = 5;
        } else if (engine.gameTime > 50 && roll < 0.25) {
          enemyType = "charger";
          hp = 8;
          speed = 2.1;
          size = 7;
          color = "#22c55e"; // bright green fast
          pts = 2;
        }

        // Periodic minutes bosses
        if (Math.floor(engine.gameTime) > 0 && Math.floor(engine.gameTime) % 60 === 0 && !engine.bossSpawned) {
          enemyType = "boss";
          hp = 450 + Math.floor(engine.gameTime) * 3;
          speed = 0.7;
          size = 28;
          color = "#d946ef"; // purple mega boss
          pts = 20;
          engine.bossSpawned = true;
          engine.damageTexts.push({
            x: engine.player.x,
            y: engine.player.y - 30,
            text: "WARNING: ELITE CARRIER DETECTED!",
            color: "#f43f5e",
            alpha: 1,
            vy: -0.5
          });
        }

        if (Math.floor(engine.gameTime) % 60 !== 0) {
          engine.bossSpawned = false; // reset spawn toggle
        }

        // Spawn 350-450px out in random direction
        const spawnAngle = Math.random() * Math.PI * 2;
        const dist = 380 + Math.random() * 50;
        const enemyX = engine.player.x + Math.cos(spawnAngle) * dist;
        const enemyY = engine.player.y + Math.sin(spawnAngle) * dist;

        engine.enemies.push({
          id: Math.random().toString(),
          x: enemyX,
          y: enemyY,
          hp,
          maxHp: hp,
          speed,
          size,
          color,
          type: enemyType,
          points: pts,
        });
      }

      // 6. UPDATE ENEMIES (MOVE TOWARDS PLAYER)
      engine.enemies.forEach((enemy) => {
        const edx = engine.player.x - enemy.x;
        const edy = engine.player.y - enemy.y;
        const edist = Math.sqrt(edx * edx + edy * edy);
        if (edist > 0) {
          enemy.x += (edx / edist) * enemy.speed * dt;
          enemy.y += (edy / edist) * enemy.speed * dt;
        }

        // Player Collision Damage Check
        if (edist < engine.player.size + enemy.size) {
          const dmg = (enemy.type === "boss" ? 0.8 : enemy.type === "goliath" ? 0.4 : 0.15) * dt;
          // Apply armor reduction from meta shop
          const armorReduction = shopUpgrades.regen * 0.05; // Use regen levels as minor armor reduction too
          const finalHit = Math.max(0.05, dmg * (1 - armorReduction));
          engine.player.hp -= finalHit;

          if (Math.random() < 0.05) {
            playSfx("hurt");
            engine.damageTexts.push({
              x: engine.player.x + (Math.random() - 0.5) * 15,
              y: engine.player.y - 12,
              text: `-${Math.round(finalHit * 10) / 10}`,
              color: "#f87171",
              alpha: 1,
              vy: -0.8
            });
          }
        }
      });

      // 7. ORBITING SHIELD WEAPON PASSIVE DAMAGE COLLISION
      const shieldWpn = engine.weapons.find((w) => w.id === "nanoshield");
      if (shieldWpn) {
        const orbCount = shieldWpn.level >= 5 ? 4 : shieldWpn.level >= 4 ? 3 : shieldWpn.level >= 2 ? 2 : 1;
        const orbitRadius = shieldWpn.level >= 4 ? 75 : 60;
        const shieldDmg = (8 + shieldWpn.level * 4) * engine.player.damageMultiplier;

        for (let i = 0; i < orbCount; i++) {
          const angle = engine.shieldAngle + (i / orbCount) * Math.PI * 2;
          const sx = engine.player.x + Math.cos(angle) * orbitRadius;
          const sy = engine.player.y + Math.sin(angle) * orbitRadius;

          engine.enemies.forEach((e) => {
            const sedx = e.x - sx;
            const sedy = e.y - sy;
            const sedist = Math.sqrt(sedx * sedx + sedy * sedy);
            if (sedist < e.size + 8) {
              e.hp -= shieldDmg * 0.1 * dt; // deals ticking damage over frame delta
              if (Math.random() < 0.06 * dt) {
                playSfx("hit");
                engine.damageTexts.push({
                  x: e.x,
                  y: e.y - 10,
                  text: `${Math.round(shieldDmg)}`,
                  color: "#10b981",
                  alpha: 1,
                  vy: -1.2
                });
                // Small green dust particles on slice hit
                engine.particles.push({
                  x: e.x,
                  y: e.y,
                  vx: (Math.random() - 0.5) * 4,
                  vy: (Math.random() - 0.5) * 4,
                  color: "#10b981",
                  size: 2,
                  alpha: 1,
                  decay: 0.06
                });
              }
            }
          });
        }
      }

      // 8. UPDATE PROJECTILES & BULLET COLLISION
      for (let i = engine.projectiles.length - 1; i >= 0; i--) {
        const p = engine.projectiles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Check distance limit off screen
        const pdx = p.x - engine.player.x;
        const pdy = p.y - engine.player.y;
        if (Math.sqrt(pdx * pdx + pdy * pdy) > 500) {
          engine.projectiles.splice(i, 1);
          continue;
        }

        // Enemy Hits
        for (let j = engine.enemies.length - 1; j >= 0; j--) {
          const e = engine.enemies[j];
          const cdx = e.x - p.x;
          const cdy = e.y - p.y;
          const cdist = Math.sqrt(cdx * cdx + cdy * cdy);

          if (cdist < e.size + p.size) {
            e.hp -= p.damage;
            playSfx("hit");

            engine.damageTexts.push({
              x: e.x,
              y: e.y - 10,
              text: `${Math.round(p.damage)}`,
              color: "#38bdf8",
              alpha: 1,
              vy: -1.3
            });

            // Spark splash
            for (let s = 0; s < 4; s++) {
              engine.particles.push({
                x: p.x,
                y: p.y,
                vx: (Math.random() - 0.5) * 4 + p.vx * 0.1,
                vy: (Math.random() - 0.5) * 4 + p.vy * 0.1,
                color: p.color,
                size: 2,
                alpha: 1,
                decay: 0.07
              });
            }

            p.pierce -= 1;
            if (p.pierce <= 0) {
              engine.projectiles.splice(i, 1);
              break;
            }
          }
        }
      }

      // 9. CLEAN DEFEATED ENEMIES & DROP XP/GOLD
      for (let i = engine.enemies.length - 1; i >= 0; i--) {
        const e = engine.enemies[i];
        if (e.hp <= 0) {
          playSfx("kill");
          engine.player.kills += 1;

          // Splatter particles
          for (let sp = 0; sp < 8; sp++) {
            engine.particles.push({
              x: e.x,
              y: e.y,
              vx: (Math.random() - 0.5) * 5,
              vy: (Math.random() - 0.5) * 5,
              color: e.color,
              size: 2 + Math.random() * 3,
              alpha: 1,
              decay: 0.05
            });
          }

          // Randomize dropping Gold Coins or XP Orbs
          const isBoss = e.type === "boss";
          const isGold = isBoss ? true : Math.random() < 0.18; // 18% gold chance from normal targets

          engine.items.push({
            x: e.x,
            y: e.y,
            amount: isBoss ? 15 : e.points,
            size: isGold ? 4 : 3,
            color: isGold ? "#fbbf24" : isBoss ? "#d946ef" : "#10b981", // gold, magenta for boss, green for standard xp
            isGold,
            pulling: false,
          });

          engine.enemies.splice(i, 1);
        }
      }

      // 10. MAGNETIC PICKUPS MATRIX
      for (let i = engine.items.length - 1; i >= 0; i--) {
        const item = engine.items[i];
        const idx = engine.player.x - item.x;
        const idy = engine.player.y - item.y;
        const idist = Math.sqrt(idx * idx + idy * idy);

        if (idist < engine.player.magnetRange) {
          item.pulling = true;
        }

        if (item.pulling) {
          // Speed up towards player
          item.x += (idx / idist) * 5 * dt;
          item.y += (idy / idist) * 5 * dt;
        }

        // Actual Collection
        if (idist < engine.player.size + item.size + 4) {
          playSfx("xp");
          if (item.isGold) {
            engine.player.gold += item.amount;
            engine.damageTexts.push({
              x: item.x,
              y: item.y,
              text: `+${item.amount}¢`,
              color: "#fbbf24",
              alpha: 1,
              vy: -1.2
            });
          } else {
            engine.player.xp += item.amount;
          }

          // Check level up!
          if (engine.player.xp >= engine.player.xpNeeded) {
            engine.player.xp -= engine.player.xpNeeded;
            engine.player.level += 1;
            engine.player.xpNeeded = Math.floor(50 + engine.player.level * 40);
            triggerLevelUp();
          }

          engine.items.splice(i, 1);
        }
      }

      // 11. PARTICLES & DAMAGE TEXTS ANIMATION UPDATES
      for (let i = engine.particles.length - 1; i >= 0; i--) {
        const pt = engine.particles[i];
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.alpha -= pt.decay * dt;
        if (pt.alpha <= 0) {
          engine.particles.splice(i, 1);
        }
      }

      for (let i = engine.damageTexts.length - 1; i >= 0; i--) {
        const txt = engine.damageTexts[i];
        txt.y += txt.vy * dt;
        txt.alpha -= 0.03 * dt;
        if (txt.alpha <= 0) {
          engine.damageTexts.splice(i, 1);
        }
      }

      // 12. TRIGGER DEFEAT/GAME OVER
      if (engine.player.hp <= 0) {
        setGameState("GAMEOVER");
        playSfx("gameover");

        const earnedGold = engine.player.gold;
        // Credit meta gold permanently
        setMetaGold((g) => {
          const next = g + earnedGold;
          localStorage.setItem("pioneer_meta_gold", next.toString());
          return next;
        });

        // Save High Scores
        const finalTime = timeStr;
        const finalKills = engine.player.kills;
        const finalLevel = engine.player.level;

        setFinalStats({
          time: finalTime,
          kills: finalKills,
          gold: earnedGold,
          level: finalLevel,
          unlockedGold: earnedGold
        });

        setHighScores((prev) => {
          const next = [
            ...prev,
            {
              time: finalTime,
              kills: finalKills,
              gold: earnedGold,
              level: finalLevel,
              date: new Date().toLocaleDateString(),
            },
          ]
            .sort((a, b) => b.kills - a.kills)
            .slice(0, 5);
          localStorage.setItem("pioneer_highscores", JSON.stringify(next));
          return next;
        });

        return; // stop loops
      }

      // 13. SYNC GRAPHIC RENDER COORDINATES (SCROLLING CAMERA)
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      // Draw infinite background grid
      const gridSpacing = 60;
      const offsetX = -engine.player.x % gridSpacing;
      const offsetY = -engine.player.y % gridSpacing;
      ctx.strokeStyle = "rgba(226, 184, 94, 0.07)";
      ctx.lineWidth = 1;

      for (let gx = offsetX; gx < canvas.width; gx += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, canvas.height);
        ctx.stroke();
      }
      for (let gy = offsetY; gy < canvas.height; gy += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(canvas.width, gy);
        ctx.stroke();
      }

      // Parallax static starry field depth
      for (let s = 0; s < 45; s++) {
        const starSpeed = 0.25;
        const starX = ((s * 419) % canvas.width) - (engine.player.x * starSpeed) % canvas.width;
        const starY = ((s * 331) % canvas.height) - (engine.player.y * starSpeed) % canvas.height;
        const finalX = (starX + canvas.width) % canvas.width;
        const finalY = (starY + canvas.height) % canvas.height;

        ctx.fillStyle = `rgba(255, 255, 255, ${0.1 + (s % 4) * 0.2})`;
        ctx.fillRect(finalX, finalY, (s % 2) + 1, (s % 2) + 1);
      }

      // Draw XP/Gold items
      engine.items.forEach((item) => {
        const itemX = item.x - engine.player.x + cx;
        const itemY = item.y - engine.player.y + cy;

        ctx.shadowBlur = 8;
        ctx.shadowColor = item.color;
        ctx.fillStyle = item.color;

        ctx.beginPath();
        ctx.arc(itemX, itemY, item.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0; // reset
      });

      // Draw Particles
      engine.particles.forEach((p) => {
        const px = p.x - engine.player.x + cx;
        const py = p.y - engine.player.y + cy;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fillRect(px - p.size / 2, py - p.size / 2, p.size, p.size);
      });
      ctx.globalAlpha = 1.0; // Reset alpha

      // Draw Projectiles
      engine.projectiles.forEach((p) => {
        const px = p.x - engine.player.x + cx;
        const py = p.y - engine.player.y + cy;

        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Draw Orbiting Shield weapon orbs on camera coords
      if (shieldWpn) {
        const orbCount = shieldWpn.level >= 5 ? 4 : shieldWpn.level >= 4 ? 3 : shieldWpn.level >= 2 ? 2 : 1;
        const orbitRadius = shieldWpn.level >= 4 ? 75 : 60;
        for (let i = 0; i < orbCount; i++) {
          const angle = engine.shieldAngle + (i / orbCount) * Math.PI * 2;
          const sx = Math.cos(angle) * orbitRadius + cx;
          const sy = Math.sin(angle) * orbitRadius + cy;

          ctx.shadowBlur = 12;
          ctx.shadowColor = "#34d399";
          ctx.fillStyle = "#10b981";
          ctx.beginPath();
          ctx.arc(sx, sy, 7, 0, Math.PI * 2);
          ctx.fill();

          // Connect laser arc lines to player center
          ctx.strokeStyle = "rgba(16, 185, 129, 0.25)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(sx, sy);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // Draw Swarm Enemies
      engine.enemies.forEach((e) => {
        const ex = e.x - engine.player.x + cx;
        const ey = e.y - engine.player.y + cy;

        // Oscillating spidery/tentacle monster legs wiggling dynamically
        const moveOsc = Math.sin(engine.gameTime * 14 + parseInt(e.id) * 3);
        ctx.strokeStyle = e.color;
        ctx.lineWidth = Math.max(1.5, e.size * 0.15);

        // Draw 6 wiggly legs
        for (let leg = 0; leg < 6; leg++) {
          const angle = (leg / 6) * Math.PI * 2 + moveOsc * 0.25;
          const lx = ex + Math.cos(angle) * (e.size * 1.35);
          const ly = ey + Math.sin(angle) * (e.size * 1.35);

          ctx.beginPath();
          ctx.moveTo(ex, ey);
          // Curve slightly to look organic
          ctx.quadraticCurveTo(
            ex + Math.cos(angle + 0.2) * (e.size * 0.8),
            ey + Math.sin(angle + 0.2) * (e.size * 0.8),
            lx,
            ly
          );
          ctx.stroke();
        }

        // Core cartoon monster blob shape (squishy)
        ctx.fillStyle = e.color;
        ctx.beginPath();
        const rx = e.size * (1 + moveOsc * 0.06);
        const ry = e.size * (1 - moveOsc * 0.06);
        ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();

        // Small cute/scary monster horns wiggling on top
        ctx.fillStyle = e.color;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
        ctx.lineWidth = 1;
        // Left horn
        ctx.beginPath();
        ctx.moveTo(ex - e.size * 0.5, ey - e.size * 0.7);
        ctx.lineTo(ex - e.size * 0.8, ey - e.size * 1.25 + moveOsc * 1.5);
        ctx.lineTo(ex - e.size * 0.2, ey - e.size * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Right horn
        ctx.beginPath();
        ctx.moveTo(ex + e.size * 0.2, ey - e.size * 0.7);
        ctx.lineTo(ex + e.size * 0.8, ey - e.size * 1.25 - moveOsc * 1.5);
        ctx.lineTo(ex + e.size * 0.5, ey - e.size * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Angry Monster Face
        // 1 or 2 glowing angry eyes based on size
        if (e.size < 11) {
          // Large Cyclops Eye for smaller drones
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(ex, ey - e.size * 0.15, e.size * 0.35, 0, Math.PI * 2);
          ctx.fill();
          // Angry red pupil
          ctx.fillStyle = "#ef4444";
          ctx.beginPath();
          ctx.arc(ex + (moveOsc > 0 ? 0.7 : -0.7), ey - e.size * 0.15, e.size * 0.15, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Two angry diagonal white eyes with red pupils for larger foes
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.ellipse(ex - e.size * 0.3, ey - e.size * 0.2, e.size * 0.22, e.size * 0.12, -Math.PI / 6, 0, Math.PI * 2);
          ctx.ellipse(ex + e.size * 0.3, ey - e.size * 0.2, e.size * 0.22, e.size * 0.12, Math.PI / 6, 0, Math.PI * 2);
          ctx.fill();

          // Angry red pupils
          ctx.fillStyle = "#f43f5e";
          ctx.beginPath();
          ctx.arc(ex - e.size * 0.25, ey - e.size * 0.2, e.size * 0.08, 0, Math.PI * 2);
          ctx.arc(ex + e.size * 0.25, ey - e.size * 0.2, e.size * 0.08, 0, Math.PI * 2);
          ctx.fill();

          // Angry eyebrows
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ex - e.size * 0.5, ey - e.size * 0.38);
          ctx.lineTo(ex - e.size * 0.1, ey - e.size * 0.22);
          ctx.moveTo(ex + e.size * 0.5, ey - e.size * 0.38);
          ctx.lineTo(ex + e.size * 0.1, ey - e.size * 0.22);
          ctx.stroke();
        }

        // Angry growling mouth with tiny teeth (if size is big enough)
        if (e.size >= 12) {
          ctx.fillStyle = "#1e293b";
          ctx.beginPath();
          ctx.arc(ex, ey + e.size * 0.25, e.size * 0.2, 0, Math.PI);
          ctx.fill();
          // Little fangs
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.moveTo(ex - e.size * 0.12, ey + e.size * 0.25);
          ctx.lineTo(ex - e.size * 0.07, ey + e.size * 0.35);
          ctx.lineTo(ex - e.size * 0.02, ey + e.size * 0.25);
          ctx.moveTo(ex + e.size * 0.02, ey + e.size * 0.25);
          ctx.lineTo(ex + e.size * 0.07, ey + e.size * 0.35);
          ctx.lineTo(ex + e.size * 0.12, ey + e.size * 0.25);
          ctx.fill();
        }

        // Anti-Pi Logo Badge (Prohibition circle over π)
        const badgeRadius = Math.max(5.5, e.size * 0.38);
        const bx = ex;
        const by = ey + (e.size >= 12 ? -e.size * 0.55 : e.size * 0.3); // Position on forehead if large, else lower torso

        // White background circle
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(bx, by, badgeRadius, 0, Math.PI * 2);
        ctx.fill();

        // Red prohibition outer ring
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = Math.max(1, badgeRadius * 0.18);
        ctx.beginPath();
        ctx.arc(bx, by, badgeRadius - 0.5, 0, Math.PI * 2);
        ctx.stroke();

        // Dark Pi (π) text inside
        ctx.fillStyle = "#1e293b";
        const fontSize = Math.max(6, Math.round(badgeRadius * 1.25));
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("π", bx, by);

        // Red diagonal slash
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = Math.max(1, badgeRadius * 0.18);
        ctx.beginPath();
        const offset = badgeRadius * 0.707;
        ctx.moveTo(bx - offset, by - offset);
        ctx.lineTo(bx + offset, by + offset);
        ctx.stroke();

        // Monster HP Bar (Goliath or Boss Only)
        if (e.type === "goliath" || e.type === "boss") {
          const barW = e.size * 2;
          ctx.fillStyle = "#1e293b";
          ctx.fillRect(ex - barW / 2, ey - e.size - 8, barW, 4);
          ctx.fillStyle = "#3b82f6";
          ctx.fillRect(ex - barW / 2, ey - e.size - 8, barW * (e.hp / e.maxHp), 4);
        }
      });

      // Draw Pioneer Player (Cartoon character with Pi badge)
      const playerSize = engine.player.size;
      const legOsc = Math.sin(engine.gameTime * 18);

      // Cute red cartoon boots
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(cx - 5, cy + playerSize + 1 + legOsc * 2, 3.5, 0, Math.PI * 2);
      ctx.arc(cx + 5, cy + playerSize + 1 - legOsc * 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // Boot soles
      ctx.fillStyle = "#b91c1c";
      ctx.fillRect(cx - 8, cy + playerSize + 3 + legOsc * 2, 6, 2);
      ctx.fillRect(cx + 2, cy + playerSize + 3 - legOsc * 2, 6, 2);

      // Jetpack exhaust thruster flames
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(cx - playerSize - 1, cy + 3 + Math.random() * 3, 3, 8);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(cx - playerSize - 1, cy + 5 + Math.random() * 2, 2, 4);

      // Main suit body (Cute indigo space jumpsuit)
      ctx.fillStyle = "#6366f1";
      ctx.beginPath();
      ctx.arc(cx, cy, playerSize, 0, Math.PI * 2);
      ctx.fill();

      // White round cartoon gloves
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(cx - playerSize - 1, cy + 1 + legOsc * 0.5, 3, 0, Math.PI * 2);
      ctx.arc(cx + playerSize + 1, cy + 1 - legOsc * 0.5, 3, 0, Math.PI * 2);
      ctx.fill();

      // Bubble Helmet visor containing cute cartoon face
      const helmetRadius = playerSize * 0.85;
      const hx = cx;
      const hy = cy - playerSize * 0.3;

      // Outer Helmet boundary
      ctx.fillStyle = "#e0e7ff";
      ctx.beginPath();
      ctx.arc(hx, hy, helmetRadius, 0, Math.PI * 2);
      ctx.fill();

      // Face skin
      ctx.fillStyle = "#ffedd5";
      ctx.beginPath();
      ctx.arc(hx, hy, helmetRadius - 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Cute blush cheeks
      ctx.fillStyle = "rgba(244, 63, 94, 0.4)";
      ctx.beginPath();
      ctx.arc(hx - 3.5, hy + 2, 1.8, 0, Math.PI * 2);
      ctx.arc(hx + 3.5, hy + 2, 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Sparkling eyes
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(hx - 2.5, hy - 0.5, 1.5, 0, Math.PI * 2);
      ctx.arc(hx + 2.5, hy - 0.5, 1.5, 0, Math.PI * 2);
      ctx.fill();
      // Eye highlights
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(hx - 2.9, hy - 0.9, 0.5, 0, Math.PI * 2);
      ctx.arc(hx + 2.1, hy - 0.9, 0.5, 0, Math.PI * 2);
      ctx.fill();

      // Cute smile
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hx, hy + 2, 2, 0, Math.PI);
      ctx.stroke();

      // Visor glare reflection
      ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hx, hy, helmetRadius - 2.5, -Math.PI / 2.5, -Math.PI / 8);
      ctx.stroke();

      // Golden Round Chest Badge with Pi logo
      const pBadgeRadius = 4.5;
      const pbx = cx;
      const pby = cy + playerSize * 0.45;

      ctx.fillStyle = "#fbbf24";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pbx, pby, pBadgeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Dark Pi text inside badge
      ctx.fillStyle = "#1e1b4b";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("π", pbx, pby);

      // Floating HP Bar above player
      const pHealthPercent = engine.player.hp / engine.player.maxHp;
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(cx - 15, cy - 26, 30, 4);
      ctx.fillStyle = pHealthPercent > 0.4 ? "#22c55e" : "#ef4444";
      ctx.fillRect(cx - 15, cy - 26, 30 * Math.max(0, pHealthPercent), 4);

      // Draw Damage / XP floating text overlays
      engine.damageTexts.forEach((txt) => {
        const tx = txt.x - engine.player.x + cx;
        const ty = txt.y - engine.player.y + cy;
        ctx.fillStyle = txt.color;
        ctx.globalAlpha = Math.max(0, txt.alpha);
        ctx.font = "bold 11px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(txt.text, tx, ty);
      });
      ctx.globalAlpha = 1.0;

      // Draw Virtual Touch Joystick overlay if touched
      if (engine.joystick.active) {
        const j = engine.joystick;
        const jdx = j.curX - j.startX;
        const jdy = j.curY - j.startY;
        const jdist = Math.sqrt(jdx * jdx + jdy * jdy);
        const limitDist = Math.min(jdist, 55);
        const knobX = j.startX + (jdist > 0 ? (jdx / jdist) * limitDist : 0);
        const knobY = j.startY + (jdist > 0 ? (jdy / jdist) * limitDist : 0);

        // Outer concentric thin gold alignment circle
        ctx.strokeStyle = "rgba(226, 184, 94, 0.45)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(j.startX, j.startY, 45, 0, Math.PI * 2);
        ctx.stroke();

        // Outer dashed alignment circle
        ctx.strokeStyle = "rgba(99, 102, 241, 0.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.arc(j.startX, j.startY, 55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash

        // Vector calibration crosshairs
        ctx.strokeStyle = "rgba(99, 102, 241, 0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(j.startX - 65, j.startY);
        ctx.lineTo(j.startX + 65, j.startY);
        ctx.moveTo(j.startX, j.startY - 65);
        ctx.lineTo(j.startX, j.startY + 65);
        ctx.stroke();

        // Inner solid joystick center knob
        ctx.fillStyle = "rgba(99, 102, 241, 0.4)";
        ctx.beginPath();
        ctx.arc(knobX, knobY, 18, 0, Math.PI * 2);
        ctx.fill();

        // Knob gold ring outline
        ctx.strokeStyle = "#e2b85e";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(knobX, knobY, 18, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Sync variables cleanly to React state for UI overlays (Debounced inside tick)
      if (Math.random() < 0.15) {
        setGameStats({
          time: timeStr,
          kills: engine.player.kills,
          gold: engine.player.gold,
          level: engine.player.level,
          xpPercent: Math.floor((engine.player.xp / engine.player.xpNeeded) * 100),
          hpPercent: Math.floor((engine.player.hp / engine.player.maxHp) * 100),
        });
      }

      animId = requestAnimationFrame(gameLoop);
    };

    animId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animId);
  }, [gameState]);

  // Handle touch joystick event listeners directly on parent
  const handleTouchStart = (e: React.TouchEvent) => {
    if (gameState !== "PLAYING" || isLevelUp) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const clientX = touch.clientX - rect.left;
    const clientY = touch.clientY - rect.top;

    // Joystick fires anywhere on bottom half of game container
    if (clientY > canvas.height * 0.4) {
      engineRef.current.joystick = {
        active: true,
        startX: clientX,
        startY: clientY,
        curX: clientX,
        curY: clientY,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (gameState !== "PLAYING" || !engineRef.current.joystick.active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const clientX = touch.clientX - rect.left;
    const clientY = touch.clientY - rect.top;

    engineRef.current.joystick.curX = clientX;
    engineRef.current.joystick.curY = clientY;
  };

  const handleTouchEnd = () => {
    engineRef.current.joystick.active = false;
  };

  return (
    <div className="min-h-screen bg-brand-bg text-slate-800 font-sans flex flex-col items-center justify-center p-4 relative overflow-hidden select-none geometric-grid">
      {/* Absolute Aesthetic Background Glow Elements */}
      <div className="absolute top-1/4 left-1/4 w-80 h-80 rounded-full bg-brand-accent/5 blur-3xl pointer-events-none pulse-grid"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-indigo-500/5 blur-3xl pointer-events-none pulse-grid"></div>

      {/* Main Container constrained to 9:16 optimized viewport */}
      <div
        ref={containerRef}
        className="w-full max-w-[440px] h-[80vh] md:h-[84vh] aspect-[9/16] bg-brand-card rounded-2xl border-2 border-brand-border shadow-2xl flex flex-col relative overflow-hidden"
      >
        {/* Geometric Calibration Crosshairs on Corners */}
        <div className="absolute top-2.5 left-2.5 text-[10px] font-mono text-brand-muted/20 pointer-events-none select-none">+</div>
        <div className="absolute top-2.5 right-2.5 text-[10px] font-mono text-brand-muted/20 pointer-events-none select-none">+</div>
        <div className="absolute bottom-2.5 left-2.5 text-[10px] font-mono text-brand-muted/20 pointer-events-none select-none">+</div>
        <div className="absolute bottom-2.5 right-2.5 text-[10px] font-mono text-brand-muted/20 pointer-events-none select-none">+</div>

        {/* ==========================================
            AUDIO & PERFORMANCES HUD
            ========================================== */}
        <button
          onClick={toggleMute}
          className="absolute top-4 left-4 z-40 p-2 bg-brand-card border border-brand-border hover:border-brand-accent/40 rounded-lg cursor-pointer text-brand-muted transition geo-shadow-sm"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-rose-500" /> : <Volume2 className="w-4 h-4 text-brand-accent" />}
        </button>

        {/* ==========================================
            1. START SCREEN LAYOUT
            ========================================== */}
        {gameState === "START" && (
          <div className="absolute inset-0 z-30 flex flex-col justify-between p-6 overflow-y-auto bg-gradient-to-b from-slate-50 via-brand-card to-slate-100">
            {/* Title Block */}
            <div className="text-center mt-6">
              <div className="flex items-center justify-center space-x-1.5 text-brand-accent font-bold tracking-widest text-[9px] uppercase mb-1 font-mono">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Casu-Roguelike Survival // V1.4</span>
              </div>
              <h1 className="text-4xl font-extrabold tracking-tighter text-slate-800 font-display uppercase leading-none">
                PIONEER
              </h1>
              <h2 className="text-sm font-semibold tracking-[0.3em] text-brand-accent font-mono mt-0.5 uppercase">
                SURVIVORS
              </h2>
            </div>

            {/* Concentric Geometric Radar Scanner */}
            <div className="my-4 flex flex-col items-center justify-center relative py-6">
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {/* Subtle grid ticks or circles */}
                <div className="w-32 h-32 rounded-full border border-brand-border/40 flex items-center justify-center">
                  <div className="w-24 h-24 rounded-full border border-brand-border/60 border-dashed flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full border border-brand-accent/20 flex items-center justify-center"></div>
                  </div>
                </div>
              </div>
              {/* Centered high-tech space suit avatar icon */}
              <div className="w-20 h-20 rounded-full bg-brand-card/90 border border-brand-border flex items-center justify-center relative z-10 geo-shadow-sm">
                {/* Rotating radar laser scan line */}
                <div className="absolute inset-1 rounded-full border border-indigo-500/25 animate-spin" style={{ animationDuration: '4s' }}>
                  <div className="w-1/2 h-full bg-gradient-to-l from-indigo-500/20 to-transparent origin-right absolute left-0 top-0"></div>
                </div>
                {/* Simple helmet visor outline */}
                <div className="w-11 h-11 rounded-xl bg-slate-100 border border-brand-border relative overflow-hidden flex flex-col items-center justify-center">
                  <div className="w-8 h-4 rounded-b bg-brand-accent/20 border-b border-brand-accent/40 mt-1"></div>
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute top-1 right-2 animate-pulse"></div>
                </div>
              </div>
              <div className="mt-3.5 text-[9px] font-mono text-brand-muted uppercase tracking-widest">
                Unit Core Status: Calibrated
              </div>
            </div>

            {/* Play & Info Buttons */}
            <div className="space-y-3 px-1">
              <button
                onClick={startNewGame}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/20 text-white font-bold rounded-xl flex items-center justify-center space-x-2 transition cursor-pointer geo-shadow-indigo active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
              >
                <Play className="w-4 h-4 fill-current text-white" />
                <span className="font-display uppercase tracking-wider text-xs">Launch Pioneer Core</span>
              </button>

              <button
                onClick={() => setShowTutorial(true)}
                className="w-full py-2.5 bg-brand-card border border-brand-border hover:bg-slate-50 text-slate-700 font-bold rounded-lg cursor-pointer flex items-center justify-center space-x-2 transition text-xs geo-shadow-sm"
              >
                <HelpCircle className="w-4 h-4 text-brand-accent" />
                <span className="font-display uppercase tracking-widest text-[10px]">Survival Protocols</span>
              </button>
            </div>

            {/* Permanent Upgrades Matrix Shop */}
            <div className="bg-brand-card border border-brand-border rounded-xl p-4 my-2.5">
              <div className="flex items-center justify-between border-b border-brand-border pb-2.5 mb-2.5">
                <div className="flex items-center space-x-2">
                  <Coins className="w-4 h-4 text-brand-accent" />
                  <span className="font-display font-bold text-xs uppercase tracking-wider text-slate-700">Base Engineering Shop</span>
                </div>
                <div className="bg-amber-500/10 border border-brand-accent/25 px-2.5 py-0.5 rounded text-xs text-brand-accent font-mono font-bold">
                  {metaGold} ¢
                </div>
              </div>

              {/* Pi Integration HUD Section */}
              {typeof window !== "undefined" && (window as any).Pi ? (
                <div className="mb-3 p-2 bg-purple-50 rounded-lg border border-purple-200/60 flex flex-col space-y-1.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center space-x-1 font-mono text-purple-700 font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>Pi Network Connected</span>
                    </div>
                    {piUser ? (
                      <span className="text-purple-600 font-bold">@{piUser.username}</span>
                    ) : (
                      <button
                        onClick={() => handlePiAuth(true)}
                        disabled={piPaymentStatus === "authenticating"}
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded cursor-pointer transition duration-150 shadow-sm"
                      >
                        {piPaymentStatus === "authenticating" ? "Signing In..." : "Sign In"}
                      </button>
                    )}
                  </div>

                  {piPaymentError && !piUser && (
                    <div className="text-[9px] text-rose-500 font-mono mt-1 leading-normal border-t border-purple-100/50 pt-1">
                      ⚠️ Lỗi: {piPaymentError}
                    </div>
                  )}
                  
                  {/* Mode switcher toggle */}
                  <div className="flex items-center justify-between bg-white p-1 rounded border border-purple-200/50">
                    <span className="text-[9px] text-slate-600 font-medium pl-1">Payment Protocol:</span>
                    <button
                      onClick={() => setPayWithPiMode(!payWithPiMode)}
                      className={`px-2 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider font-bold transition duration-200 cursor-pointer ${
                        payWithPiMode
                          ? "bg-purple-600 text-white shadow-sm"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {payWithPiMode ? "π Testnet (Pi)" : "¢ Credits (Local)"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mb-3 p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-center text-[8px] font-mono text-slate-500 uppercase tracking-wider">
                  Open inside Pi Browser to enable π payments
                </div>
              )}

              {/* API Configuration Status Indicator */}
              <div className="mb-3.5 p-2 bg-slate-50 border border-brand-border rounded-lg text-[10px] space-y-1 font-sans">
                <div className="flex items-center justify-between text-slate-600 font-medium">
                  <span className="flex items-center space-x-1">
                    <Shield className="w-3 h-3 text-brand-accent" />
                    <span>Pi API Key (Backend):</span>
                  </span>
                  <span className={`font-bold font-mono px-1.5 py-0.5 rounded text-[8px] uppercase ${
                    piApiKeyConfigured === true
                      ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                      : piApiKeyConfigured === false
                      ? "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                      : "bg-slate-100 text-slate-500"
                  }`}>
                    {piApiKeyConfigured === true ? "Connected" : piApiKeyConfigured === false ? "Not Configured" : "Checking..."}
                  </span>
                </div>
                {piApiKeyConfigured === false && (
                  <p className="text-[9px] text-rose-500 leading-normal font-medium bg-rose-50/50 p-1 rounded border border-rose-100">
                    Vui lòng mở <strong>Settings</strong> trong AI Studio (hoặc cấu hình <strong>Environment Variables</strong> trên <strong>Vercel Dashboard</strong> nếu bạn đã deploy) để thiết lập khóa <strong>PI_API_KEY</strong>. Giao dịch Pi sẽ lỗi nếu thiếu khóa này.
                  </p>
                )}
              </div>

              {/* Tab Selector */}
              <div className="flex border-b border-brand-border mb-3 text-xs bg-slate-50 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setShopTab("upgrades")}
                  className={`flex-1 py-1.5 text-center font-display font-bold uppercase tracking-wider text-[9px] rounded-md transition cursor-pointer ${
                    shopTab === "upgrades"
                      ? "bg-purple-600 text-white shadow-sm font-extrabold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Systems Upgrades
                </button>
                <button
                  type="button"
                  onClick={() => setShopTab("exchange")}
                  className={`flex-1 py-1.5 text-center font-display font-bold uppercase tracking-wider text-[9px] rounded-md transition cursor-pointer ${
                    shopTab === "exchange"
                      ? "bg-purple-600 text-white shadow-sm font-extrabold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Pi Exchange (Buy/Sell)
                </button>
              </div>

              {shopTab === "upgrades" ? (
                /* Individual Shop Upgrade Slots */
                <div className="space-y-3 max-h-[160px] overflow-y-auto pr-1">
                  {[
                    { key: "damage", label: "Plasma Accelerators", icon: <Zap className="w-3.5 h-3.5" />, cost: (shopUpgrades.damage + 1) * 20, desc: "+15% Damage scaling" },
                    { key: "health", label: "Nanoshield Armor", icon: <Heart className="w-3.5 h-3.5" />, cost: (shopUpgrades.health + 1) * 15, desc: "+15 Base Max HP" },
                    { key: "speed", label: "Reactor Thrusters", icon: <Activity className="w-3.5 h-3.5" />, cost: (shopUpgrades.speed + 1) * 20, desc: "+10% Move speed" },
                    { key: "magnet", label: "Quantum Harvester", icon: <Sparkles className="w-3.5 h-3.5" />, cost: (shopUpgrades.magnet + 1) * 15, desc: "+25px Attraction radius" },
                    { key: "regen", label: "Nanite Repair Systems", icon: <Heart className="w-3.5 h-3.5" />, cost: (shopUpgrades.regen + 1) * 25, desc: "+0.35 HP Regen/sec" },
                  ].map((item) => {
                    const currentLvl = (shopUpgrades as any)[item.key];
                    const maxed = currentLvl >= 5;
                    const canBuy = payWithPiMode ? (typeof window !== "undefined" && (window as any).Pi) : (metaGold >= item.cost);
                    
                    return (
                      <div key={item.key} className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border-2 border-brand-border">
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="flex items-center space-x-1.5">
                            <span className={payWithPiMode ? "text-purple-600" : "text-brand-accent"}>{item.icon}</span>
                            <span className="text-[11px] font-bold font-display uppercase tracking-wide text-slate-800">{item.label}</span>
                          </div>
                          <span className="text-[9px] text-brand-muted block leading-tight mt-0.5 font-sans">{item.desc}</span>
                          {/* Custom analog power levels block indicator */}
                          <div className="flex space-x-1 mt-1.5">
                            {[1, 2, 3, 4, 5].map((i) => (
                              <div
                                key={i}
                                className={`w-3.5 h-2 border border-brand-border ${
                                  i <= currentLvl
                                    ? payWithPiMode
                                      ? "bg-purple-600 border-purple-600"
                                      : "bg-brand-accent border-brand-accent"
                                    : "bg-slate-200"
                                }`}
                              />
                            ))}
                          </div>
                        </div>

                        <button
                          disabled={maxed || !canBuy}
                          onClick={() => buyShopUpgrade(item.key as any, item.cost)}
                          className={`px-3 py-1.5 border-2 font-mono text-xs font-bold transition flex flex-col items-center justify-center cursor-pointer min-w-[72px] rounded-lg ${
                            maxed
                              ? "bg-slate-100 text-brand-muted/40 border-brand-border"
                              : payWithPiMode
                              ? "bg-purple-600 hover:bg-purple-500 text-white border-purple-500 hover:border-purple-400"
                              : metaGold >= item.cost
                              ? "bg-brand-accent hover:bg-amber-600 text-white border-brand-accent"
                              : "bg-slate-100 text-brand-muted/50 border-brand-border"
                          }`}
                        >
                          {maxed ? (
                            <span>MAXED</span>
                          ) : payWithPiMode ? (
                            <>
                              <span className="text-[8px] opacity-85 uppercase leading-none">Pi Pay</span>
                              <span className="font-bold mt-0.5">{(item.cost * 0.001).toFixed(3)}π</span>
                            </>
                          ) : (
                            <>
                              <span className="text-[8px] opacity-80 uppercase leading-none">Upgrade</span>
                              <span className="font-bold mt-0.5">{item.cost}¢</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Pi Exchange Panel */
                <div className="space-y-3.5 max-h-[190px] overflow-y-auto pr-1">
                  <div className="p-2 bg-purple-50 rounded-lg border border-purple-100 text-[9px] font-mono leading-normal text-purple-700">
                    <span className="font-extrabold text-purple-800 uppercase block mb-1">Giao dịch phi tập trung:</span>
                    • Nạp: 1 Pi Testnet = 10,000 Xu (¢)<br />
                    • Rút: 20,000 Xu (¢) = 1 Pi Testnet<br />
                    • Rút tối thiểu: 500 Xu (¢)
                  </div>

                  {/* Buy options */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold font-display uppercase tracking-wider text-slate-500 block">
                      🛒 Nạp Xu (Trả Pi từ Ví)
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { coins: 100, pi: 0.01 },
                        { coins: 500, pi: 0.05 },
                        { coins: 1000, pi: 0.10 },
                        { coins: 5000, pi: 0.50 }
                      ].map((pkg) => (
                        <button
                          key={pkg.coins}
                          onClick={() => buyCoinsWithPi(pkg.coins, pkg.pi)}
                          className="p-1.5 border border-purple-200 hover:border-purple-500 bg-white hover:bg-purple-50/30 transition text-left rounded-lg cursor-pointer flex flex-col justify-between shadow-sm"
                        >
                          <span className="text-[10px] font-mono font-bold text-slate-800">+{pkg.coins} Xu</span>
                          <span className="text-[8px] font-bold font-mono text-purple-600 mt-0.5">{pkg.pi} π</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sell options */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold font-display uppercase tracking-wider text-slate-500 block">
                      💰 Rút Xu (Nhận Pi về Ví)
                    </span>
                    {piUser ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        {[
                          { coins: 500, pi: 0.025 },
                          { coins: 1000, pi: 0.05 },
                          { coins: 2000, pi: 0.10 },
                          { coins: 5000, pi: 0.25 }
                        ].map((pkg) => {
                          const disabled = metaGold < pkg.coins;
                          return (
                            <button
                              key={pkg.coins}
                              disabled={disabled}
                              onClick={() => sellCoinsForPi(pkg.coins, pkg.pi)}
                              className={`p-1.5 border transition text-left rounded-lg cursor-pointer flex flex-col justify-between shadow-sm ${
                                disabled
                                  ? "opacity-45 border-slate-200 bg-slate-50 cursor-not-allowed"
                                  : "border-amber-200 hover:border-amber-500 bg-white hover:bg-amber-50/20"
                              }`}
                            >
                              <span className="text-[10px] font-mono font-bold text-slate-800">-{pkg.coins} Xu</span>
                              <span className="text-[8px] font-bold font-mono text-amber-600 mt-0.5">+{pkg.pi} π</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-center text-[9px] text-slate-500 font-medium">
                        Vui lòng kết nối ví Pi để thực hiện chức năng Bán Xu.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* High Scores list */}
            {highScores.length > 0 && (
              <div className="bg-brand-card border border-brand-border rounded-xl p-3.5">
                <div className="flex items-center space-x-2 text-brand-muted text-[10px] font-bold uppercase tracking-wider mb-2 font-mono">
                  <Trophy className="w-4 h-4 text-brand-accent" />
                  <span>Mission Log Records</span>
                </div>
                <div className="space-y-1.5 font-mono">
                  {highScores.map((score, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-lg border-2 border-brand-border text-xs">
                      <div className="flex items-center space-x-2">
                        <span className="text-brand-accent">0{idx + 1}.</span>
                        <span className="text-slate-700">{score.time}</span>
                      </div>
                      <div className="flex items-center space-x-3.5">
                        <span className="text-rose-400 font-bold">{score.kills} KILLS</span>
                        <span className="text-indigo-400 font-bold">LV.{score.level}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* System Clear Button */}
            <div className="text-center mt-1">
              <button
                onClick={resetSaveData}
                className="text-[9px] text-brand-muted hover:text-rose-500 font-mono cursor-pointer transition underline uppercase tracking-wider"
              >
                Clear Saved Base Data
              </button>
            </div>
          </div>
        )}
               {/* ==========================================
            TUTORIAL MODAL
            ========================================== */}
        {showTutorial && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
            <div className="bg-brand-card border-2 border-brand-border rounded-xl p-5 w-full max-w-[380px] space-y-4 geo-shadow">
              <h3 className="text-lg font-bold tracking-tight text-center text-brand-accent font-display uppercase">
                Survival Protocols
              </h3>
              <div className="space-y-3 text-xs text-slate-600">
                <div className="flex items-start space-x-3">
                  <div className="w-5 h-5 bg-brand-card border border-brand-border rounded flex items-center justify-center shrink-0 font-mono text-[9px] text-brand-accent font-bold">
                    NAV
                  </div>
                  <p className="font-sans leading-tight">Slide joystick on the bottom half of the screen, or use <span className="text-brand-accent font-mono font-bold">WASD/Arrows</span> on desktop.</p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-5 h-5 bg-brand-card border border-brand-border rounded flex items-center justify-center shrink-0 font-mono text-[9px] text-brand-accent font-bold">
                    WEP
                  </div>
                  <p className="font-sans leading-tight">Weapons <span className="text-brand-accent font-bold">autofire automatically</span> targeting the nearest invader. Focus strictly on navigation.</p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-5 h-5 bg-brand-card border border-brand-border rounded flex items-center justify-center shrink-0 font-mono text-[9px] text-brand-accent font-bold">
                    CORE
                  </div>
                  <p className="font-sans leading-tight">Gather glowing energy orbs dropped by targets to upgrade system specs during active deployment.</p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-5 h-5 bg-brand-card border border-brand-border rounded flex items-center justify-center shrink-0 font-mono text-[9px] text-brand-accent font-bold">
                    META
                  </div>
                  <p className="font-sans leading-tight">Accumulate currency to unlock permanent engineering core upgrades inside the base shop.</p>
                </div>
              </div>
              <button
                onClick={() => setShowTutorial(false)}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg cursor-pointer text-xs transition font-display uppercase tracking-wider"
              >
                Acknowledge Protocols
              </button>
            </div>
          </div>
        )}

        {/* ==========================================
            2. PLAYING ACTIVE HUD & CANVAS
            ========================================== */}
        {gameState === "PLAYING" && (
          <div className="absolute inset-0 flex flex-col pointer-events-none">
            {/* Top Stat Progress HUD Overlay */}
            <div className="p-4 z-20 flex flex-col space-y-1 bg-gradient-to-b from-slate-950/80 via-slate-950/20 to-transparent">
              {/* Dashboard band */}
              <div className="grid grid-cols-3 gap-2.5 mb-1.5 pointer-events-none">
                {/* Level box */}
                <div className="bg-slate-900/90 border border-slate-800 px-3 py-1 rounded-lg flex items-center justify-center space-x-1.5 text-center">
                  <span className="text-slate-400 text-[8px] font-mono uppercase">Level</span>
                  <span className="text-indigo-400 font-bold font-display text-xs">{gameStats.level}</span>
                </div>
                {/* Time box */}
                <div className="bg-slate-900/90 border border-slate-800 px-3 py-1 rounded-lg flex items-center justify-center space-x-1.5 text-center">
                  <span className="text-slate-400 text-[8px] font-mono uppercase">Time</span>
                  <span className="text-slate-200 font-bold font-mono text-[11px] tracking-wider">{gameStats.time}</span>
                </div>
                {/* Kills box */}
                <div className="bg-slate-900/90 border border-rose-950/50 px-3 py-1 rounded-lg flex items-center justify-center space-x-1.5 text-center">
                  <Skull className="w-3.5 h-3.5 text-rose-500" />
                  <span className="text-rose-400 font-bold font-mono text-[11px]">{gameStats.kills}</span>
                </div>
              </div>

              {/* XP progress bar */}
              <div className="w-full h-3 bg-slate-950/60 border border-slate-800 rounded-md overflow-hidden relative">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-sky-400 to-emerald-400 transition-all duration-300"
                  style={{ width: `${gameStats.xpPercent}%` }}
                />
                {/* Grid Segment Markers overlay */}
                <div className="absolute inset-0 flex justify-between pointer-events-none px-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                    <div key={i} className="w-[1px] h-full bg-slate-800/40" />
                  ))}
                </div>
              </div>

              {/* Player Top HUD Health & Gold indicator */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center space-x-2">
                  <Heart className="w-3.5 h-3.5 text-rose-500 fill-current shrink-0" />
                  <div className="w-24 h-2 bg-slate-950/60 border border-slate-800 rounded overflow-hidden relative">
                    <div
                      className="h-full bg-gradient-to-r from-rose-600 to-rose-400 transition-all duration-150"
                      style={{ width: `${gameStats.hpPercent}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-rose-400 font-mono font-bold">{gameStats.hpPercent}%</span>
                </div>

                <div className="flex items-center space-x-1.5 text-brand-accent bg-amber-500/10 border border-brand-accent/20 px-2.5 py-0.5 rounded-md text-[10px] font-bold font-mono">
                  <Coins className="w-3.5 h-3.5" />
                  <span>{gameStats.gold}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Interactive Game Play Canvas Element */}
        {gameState === "PLAYING" && (
          <canvas
            ref={canvasRef}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="w-full h-full block bg-[#0b0f19]"
          />
        )}

        {/* ==========================================
            3. LEVEL UP OVERLAY SELECTION
            ========================================== */}
        {isLevelUp && (
          <div className="absolute inset-0 z-40 bg-slate-900/45 backdrop-blur-md flex flex-col justify-center items-center p-6 space-y-6 animate-fade-in dot-matrix">
            <div className="text-center">
              <div className="inline-block border border-brand-accent/20 bg-brand-accent/5 px-2.5 py-0.5 rounded text-[9px] font-mono text-brand-accent uppercase tracking-widest mb-1.5">
                Evolution Protocol Active
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-800 font-display uppercase">
                TACTICAL ADAPTATION
              </h2>
              <p className="text-xs text-brand-muted mt-1 font-sans">Choose engineering update to load</p>
            </div>

            {/* Upgrades List Cards */}
            <div className="space-y-3 w-full max-w-[360px]">
              {levelUpOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => applyUpgrade(opt)}
                  className="w-full flex items-center space-x-4 bg-brand-card hover:bg-slate-50 border-2 border-brand-border hover:border-brand-accent/60 p-3.5 rounded-xl text-left cursor-pointer transition transform hover:-translate-y-0.5 active:translate-y-0 geo-shadow-sm hover:geo-shadow-accent"
                >
                  <div className="p-2 bg-slate-50 border border-brand-border rounded-lg shrink-0 text-brand-accent">
                    {opt.icon}
                  </div>
                  <div className="space-y-0.5 flex-1">
                    <span className="text-xs font-bold text-slate-800 font-display block uppercase">{opt.name}</span>
                    <span className="text-[10px] text-slate-600 block leading-tight font-sans">{opt.desc}</span>
                  </div>
                  <div className="text-[9px] font-mono font-bold border border-brand-border px-1.5 py-0.5 rounded bg-brand-card text-brand-accent">
                    Lv.{opt.level}
                  </div>
                </button>
              ))}
            </div>

            {/* Ad Reroll Button (Ad Monetization Stub) */}
            <div className="pt-2 w-full max-w-[360px]">
              <button
                onClick={handleRerollAd}
                className="w-full py-2.5 bg-brand-card hover:bg-red-50 border-2 border-red-200 hover:border-red-400 text-[#ef4444] font-bold rounded-xl text-xs flex items-center justify-center space-x-2 transition cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span className="font-mono uppercase tracking-wider text-[10px]">Reroll options (Watch Broadcast)</span>
              </button>
            </div>
          </div>
        )}

        {/* ==========================================
            4. GAME OVER SCREEN OVERLAY
            ========================================== */}
        {gameState === "GAMEOVER" && (
          <div className="absolute inset-0 z-30 bg-gradient-to-b from-slate-50 via-brand-card to-slate-100 flex flex-col justify-between p-6 overflow-y-auto dot-matrix">
            {/* Defeat Banner */}
            <div className="text-center mt-6">
              <div className="inline-block border border-rose-500/20 bg-rose-500/5 px-2.5 py-0.5 rounded text-[9px] font-mono text-rose-500 uppercase tracking-widest mb-1">
                Telemetry Interrupted
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-rose-500 font-display uppercase">
                MISSION OVER
              </h1>
              <p className="text-[10px] text-brand-muted font-mono uppercase mt-0.5">Pioneer unit offline // core compromised</p>
            </div>

            {/* Run statistics */}
            <div className="bg-brand-card border border-brand-border rounded-xl p-5 space-y-4 max-w-[380px] mx-auto w-full geo-shadow">
              <h3 className="text-[11px] font-bold tracking-wider text-brand-accent border-b border-brand-border pb-1.5 uppercase font-mono flex items-center justify-between">
                <span>Log Extract Report</span>
                <span className="text-brand-muted font-normal text-[9px]">ID: 409-SWARM</span>
              </h3>
              <div className="space-y-3 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-brand-muted">Mission Duration:</span>
                  <span className="text-slate-800 font-bold">{finalStats.time}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-brand-muted">Invaders Defeated:</span>
                  <span className="text-rose-400 font-bold">{finalStats.kills} Kills</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-brand-muted">Evolution Level:</span>
                  <span className="text-indigo-400 font-bold">Level {finalStats.level}</span>
                </div>
                <div className="flex justify-between items-center border-t border-brand-border pt-3 font-sans font-bold">
                  <span className="text-brand-accent flex items-center space-x-1.5 uppercase text-[10px] tracking-wider font-display">
                    <Coins className="w-3.5 h-3.5" />
                    <span>Credits Retrieved:</span>
                  </span>
                  <span className="text-brand-accent font-mono text-sm font-bold">{finalStats.gold} ¢</span>
                </div>
              </div>
            </div>

            {/* Ad Monetization Actions (Revive & Double Gold) */}
            <div className="space-y-3 max-w-[380px] mx-auto w-full px-2">
              {!hasRevivedThisRun && (
                <button
                  onClick={handleReviveAd}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl flex items-center justify-center space-x-2 transition cursor-pointer geo-shadow-indigo active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                >
                  <Heart className="w-4 h-4 fill-current text-white" />
                  <span className="font-display uppercase tracking-wider text-xs">Revive (Watch Broadcast)</span>
                </button>
              )}

              {!doubleGoldApplied && (
                <button
                  onClick={handleDoubleGoldAd}
                  className="w-full py-2.5 bg-brand-card hover:bg-slate-50 border border-brand-accent/20 hover:border-brand-accent/40 text-brand-accent font-bold rounded-lg text-xs flex items-center justify-center space-x-2 transition cursor-pointer"
                >
                  <Coins className="w-4 h-4" />
                  <span className="font-mono uppercase tracking-wider text-[10px]">Double Gold (Watch Broadcast)</span>
                </button>
              )}

              <button
                onClick={() => setGameState("START")}
                className="w-full py-3 bg-brand-card hover:bg-slate-50 border border-brand-border hover:border-brand-muted/40 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center space-x-1 transition cursor-pointer"
              >
                <span className="font-display uppercase tracking-widest">Return to Base</span>
                <ArrowRight className="w-4 h-4 ml-1 text-brand-accent" />
              </button>
            </div>

            <div className="text-center text-[9px] text-brand-muted font-mono pb-2">
              Engine status preserved. Local save-state synchronized automatically.
            </div>
          </div>
        )}

        {/* ==========================================
            5. AD PLAYBACK ANIMATED MODAL OVERLAY
            ========================================== */}
        {adState.visible && (
          <div className="absolute inset-0 z-50 bg-slate-50 flex flex-col justify-between p-6 dot-matrix animate-fade-in">
            <div className="text-center mt-6">
              <div className="text-[10px] text-brand-accent font-mono tracking-widest uppercase mb-1">
                // Broadcaster Link Established
              </div>
              <h2 className="text-lg font-bold tracking-tight text-slate-800 font-display uppercase">
                {adState.title}
              </h2>
            </div>

            {/* Interactive video simulation loader */}
            <div className="my-4 flex flex-col items-center justify-center flex-1">
              <div className="w-full max-w-[280px] aspect-[4/3] bg-brand-card border-2 border-brand-border rounded-xl flex flex-col items-center justify-center p-4 relative overflow-hidden geo-shadow">
                <div className="absolute top-2 left-2 flex items-center space-x-1 text-[8px] text-brand-muted font-mono">
                  <span>Broadcast Signal</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                </div>

                {/* Animated graphic for sponsored space game */}
                <div className="space-y-2 text-center animate-pulse z-10">
                  <div className="flex justify-center text-brand-accent">
                    <Star className="w-8 h-8 animate-spin" />
                  </div>
                  <h4 className="text-xs font-bold tracking-wide text-brand-accent font-display uppercase">Space Cadet Academies</h4>
                  <p className="text-[10px] text-slate-600 max-w-[180px] leading-relaxed mx-auto font-sans">
                    Register now to pilot tactical cruisers across high-density outer solar sectors!
                  </p>
                </div>

                {/* Cyber backdrop lines */}
                <div className="absolute inset-0 border border-brand-border/10 grid grid-cols-6 pointer-events-none">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="border-r border-brand-border/5 h-full" />
                  ))}
                </div>
              </div>
            </div>

            {/* Simulated Countdown progress bar */}
            <div className="space-y-3 max-w-[320px] mx-auto w-full pb-6">
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden border border-brand-border">
                <div
                  className="h-full bg-gradient-to-r from-brand-accent to-indigo-500 transition-all duration-100"
                  style={{ width: `${(adState.timer / 1.5) * 100}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-brand-muted">
                <span>Hold link for rewards...</span>
                <span className="font-bold text-brand-accent">{Math.ceil(adState.timer)}s remaining</span>
              </div>
            </div>
          </div>
        )}

        {/* ==========================================
            6. PI NETWORK PAYMENT PROGRESS HUD OVERLAY
            ========================================== */}
        {piPaymentStatus !== "idle" && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-brand-card border-2 border-purple-500 rounded-xl p-5 w-full max-w-[340px] space-y-4 geo-shadow-indigo text-center">
              <div className="flex justify-center">
                {piPaymentStatus === "success" ? (
                  <div className="w-12 h-12 rounded-full bg-emerald-100 border border-emerald-400 flex items-center justify-center text-emerald-600 animate-bounce">
                    <Sparkles className="w-6 h-6" />
                  </div>
                ) : piPaymentStatus === "error" || piPaymentStatus === "cancelled" ? (
                  <div className="w-12 h-12 rounded-full bg-rose-100 border border-rose-400 flex items-center justify-center text-rose-600">
                    <Skull className="w-6 h-6" />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-full bg-purple-100 border border-purple-400 flex items-center justify-center text-purple-600 relative">
                    <div className="w-8 h-8 rounded-full border-2 border-purple-500 border-t-transparent animate-spin"></div>
                    <Star className="w-4 h-4 absolute text-purple-600" />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <h3 className="text-sm font-extrabold tracking-tight text-slate-800 font-display uppercase">
                  {piPaymentStatus === "authenticating" && "System Authentication"}
                  {piPaymentStatus === "creating" && (piPaymentType === "sell" ? "Khởi Tạo Rút Pi" : "Initiating Transaction")}
                  {piPaymentStatus === "approving" && (piPaymentType === "sell" ? "Xác Minh Giao Dịch" : "Requesting Server Approval")}
                  {piPaymentStatus === "completing" && (piPaymentType === "sell" ? "Hoàn Tất Trên Blockchain" : "Finalizing On Blockchain")}
                  {piPaymentStatus === "success" && (piPaymentType === "sell" ? "Rút Pi Thành Công" : "Upgrade Authenticated")}
                  {piPaymentStatus === "cancelled" && "Transaction Aborted"}
                  {piPaymentStatus === "error" && (piPaymentType === "sell" ? "Lỗi Rút Pi Về Ví" : "Checkout Protocol Error")}
                </h3>
                <p className="text-[10px] text-brand-muted font-mono leading-relaxed">
                  {piPaymentStatus === "authenticating" && "Synchronizing local pioneer telemetry with Pi Network authentication core..."}
                  {piPaymentStatus === "creating" && (piPaymentType === "sell" 
                    ? "Đang gửi yêu cầu khởi tạo giao dịch rút Pi về ví. Vui lòng đợi..."
                    : "Registering checkout payload on decentralized ledger. Standby..."
                  )}
                  {piPaymentStatus === "approving" && (piPaymentType === "sell"
                    ? "Hệ thống đang xác thực số dư và ký duyệt giao dịch thanh toán..."
                    : "Waiting for off-chain developer endpoints to validate checkout authenticity..."
                  )}
                  {piPaymentStatus === "completing" && (piPaymentType === "sell"
                    ? "Đang gửi chữ ký và phát sóng giao dịch lên blockchain Pi Network..."
                    : "Pioneer signed transaction! Transmitting stellar ledger proof for decentralized finalization..."
                  )}
                  {piPaymentStatus === "success" && (piPaymentType === "sell" 
                    ? `Giao dịch chuyển thành công ${piPaymentError || "Pi"} về ví của bạn.`
                    : "Pi Network ledger validated successfully. Upgrades downloaded and applied to hull."
                  )}
                  {piPaymentStatus === "cancelled" && (piPaymentType === "sell"
                    ? "Yêu cầu rút Pi của bạn đã bị hủy bỏ."
                    : "System aborted checkout. Hull telemetry safe."
                  )}
                  {piPaymentStatus === "error" && piPaymentError}
                </p>
              </div>

              {(piPaymentStatus === "error" || piPaymentStatus === "cancelled") && (
                <button
                  onClick={() => setPiPaymentStatus("idle")}
                  className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 border border-brand-border text-slate-700 font-bold rounded-lg text-[10px] font-mono cursor-pointer uppercase transition duration-150"
                >
                  Close Link
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
