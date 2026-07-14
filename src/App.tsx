import React, { useState, useEffect, useRef } from "react";
import { Language, TranslationSet, translations, languages } from "./translations";
import {
  Play, Flame, Shield, Activity, Sparkles, RotateCcw, Heart, Zap,
  Volume2, VolumeX, Trophy, Coins, Skull, Star, HelpCircle, ArrowRight,
  History, FileText, Lock, RefreshCw
} from "lucide-react";
import { db } from "./firebase";
import { collection, onSnapshot, doc, updateDoc, setDoc, deleteDoc } from "firebase/firestore";

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

interface PiTransaction {
  id: string;
  type: "deposit" | "withdrawal" | "upgrade_purchase";
  amountCoins: number;
  piAmount: number;
  status: "success" | "pending" | "failed" | "cancelled";
  timestamp: number;
  txid?: string;
  memo?: string;
  simulated?: boolean;
}

const aiTranslations: Record<string, { title: string; intensity: string; playstyle: string; status: string; activityScore: string; bonusLabel: string }> = {
  en: {
    title: "AI Director",
    intensity: "Intensity",
    playstyle: "Playstyle",
    status: "AI Status",
    activityScore: "Activity",
    bonusLabel: "REWARD BONUS",
  },
  vi: {
    title: "AI Giám Sát",
    intensity: "Độ khó AI",
    playstyle: "Lối chơi",
    status: "Trạng thái AI",
    activityScore: "Hoạt động",
    bonusLabel: "THƯỞNG THÊM",
  },
  zh: {
    title: "AI 战局导演",
    intensity: "动态难度",
    playstyle: "玩家战术",
    status: "AI 决策状态",
    activityScore: "活跃指数",
    bonusLabel: "额外奖励加成",
  },
  es: {
    title: "Director IA",
    intensity: "Intensidad",
    playstyle: "Táctica",
    status: "Estado IA",
    activityScore: "Actividad",
    bonusLabel: "BONO RECOMPENSA",
  },
  ko: {
    title: "AI 디렉터",
    intensity: "AI 난이도",
    playstyle: "플레이 성향",
    status: "AI 상태",
    activityScore: "활동량",
    bonusLabel: "추가 보상 배율",
  },
  ja: {
    title: "AI ディレクター",
    intensity: "AI 難易度",
    playstyle: "プレイスタイル",
    status: "AI ステータス",
    activityScore: "活動指数",
    bonusLabel: "追加報酬ボーナス",
  },
};

export default function App() {
  // ==========================================
  // REACT STATE (UI, Overlays, Persistent Upgrades)
  // ==========================================
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("pioneer_language") as Language;
    if (saved && ["en", "vi", "zh", "es", "ko", "ja"].includes(saved)) {
      return saved;
    }
    if (typeof navigator !== "undefined") {
      const code = navigator.language.split("-")[0];
      if (["en", "vi", "zh", "es", "ko", "ja"].includes(code)) {
        return code as Language;
      }
    }
    return "en";
  });

  const changeLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem("pioneer_language", lang);
  };

  const t = (key: keyof TranslationSet, replaces?: Record<string, string | number>) => {
    let text = translations[language][key] || translations["en"][key] || "";
    if (replaces) {
      Object.entries(replaces).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  };

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
    aiIntensity: 1.0,
    aiPlaystyle: "Cân bằng",
    aiAdjustment: "Ổn định",
    aiActivityScore: 50,
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

  // Daily grind gold limit to protect economic balance from excessive cày chay (free-to-play grinding)
  const DAILY_GRIND_LIMIT = 150;
  const SESSION_GOLD_LIMIT = 35;

  const [dailyGrindGold, setDailyGrindGold] = useState(() => {
    try {
      const today = new Date().toDateString();
      const saved = localStorage.getItem("pioneer_daily_grind_gold");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.date === today) {
          return Number(parsed.amount) || 0;
        }
      }
    } catch (e) {
      console.error("[Economy] Failed to load daily grind tracking:", e);
    }
    return 0;
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

  // ==========================================
  // EQUIPMENT, GIFT BOXES & MARKETPLACE STATES
  // ==========================================
  const [giftBoxes, setGiftBoxes] = useState<number>(() => {
    const saved = localStorage.getItem("pioneer_gift_boxes");
    return saved ? parseInt(saved, 10) : 3; // start with 3 gift boxes for new players!
  });

  const [inventory, setInventory] = useState<any[]>(() => {
    const saved = localStorage.getItem("pioneer_inventory");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    // Give starter equipment
    const starterWeapon = {
      id: "item-starter-wpn",
      name: "Súng Thám Hiểm Sơ Cấp",
      type: "weapon",
      rarity: "common",
      statType: "damage",
      value: 5,
      sellPrice: 10
    };
    const starter = [starterWeapon];
    localStorage.setItem("pioneer_inventory", JSON.stringify(starter));
    return starter;
  });

  const [equippedWeapon, setEquippedWeapon] = useState<any | null>(() => {
    const saved = localStorage.getItem("pioneer_equipped_weapon");
    try {
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const [equippedArmor, setEquippedArmor] = useState<any | null>(() => {
    const saved = localStorage.getItem("pioneer_equipped_armor");
    try {
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const [equippedAccessory, setEquippedAccessory] = useState<any | null>(() => {
    const saved = localStorage.getItem("pioneer_equipped_accessory");
    try {
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const [isOpeningBox, setIsOpeningBox] = useState(false);
  const [openedReward, setOpenedReward] = useState<{ coins: number; item: any | null } | null>(null);

  const [playerId] = useState<string>(() => {
    const saved = localStorage.getItem("pioneer_player_id");
    if (saved) return saved;
    const newId = `player-${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem("pioneer_player_id", newId);
    return newId;
  });

  const [cloudListings, setCloudListings] = useState<any[]>([]);

  const [npcListings, setNpcListings] = useState<any[]>(() => {
    const saved = localStorage.getItem("pioneer_npc_listings");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    const initialNpcs = [
      {
        id: "list-npc-1",
        item: {
          id: "item-npc-1",
          name: "Kiếm Quang Tinh Thể",
          type: "weapon",
          rarity: "rare",
          statType: "damage",
          value: 15,
          sellPrice: 35
        },
        price: 35,
        seller: "SpaceWalker_Pi",
        sold: false,
        status: "listed"
      },
      {
        id: "list-npc-2",
        item: {
          id: "item-npc-2",
          name: "Khiên Năng Lượng Đa Lớp",
          type: "armor",
          rarity: "rare",
          statType: "health",
          value: 30,
          sellPrice: 40
        },
        price: 45,
        seller: "Pioneer_X",
        sold: false,
        status: "listed"
      },
      {
        id: "list-npc-3",
        item: {
          id: "item-npc-3",
          name: "Vòng Tay Động Lực",
          type: "accessory",
          rarity: "rare",
          statType: "speed",
          value: 12,
          sellPrice: 28
        },
        price: 30,
        seller: "Antipi_Expert",
        sold: false,
        status: "listed"
      }
    ];
    localStorage.setItem("pioneer_npc_listings", JSON.stringify(initialNpcs));
    return initialNpcs;
  });

  const [isRefreshingMarketplace, setIsRefreshingMarketplace] = useState(false);
  const [selectedRarityFilter, setSelectedRarityFilter] = useState<string>("all");
  const [itemBeingListedId, setItemBeingListedId] = useState<string | null>(null);
  const [customPriceInput, setCustomPriceInput] = useState<string>("");

  // Ad simulation overlays
  const [adState, setAdState] = useState<{
    visible: boolean;
    type: "REROLL" | "REVIVE" | "DOUBLE_GOLD" | "DAILY_CHECKIN" | null;
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
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showTermsOfService, setShowTermsOfService] = useState(false);

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
  const [shopTab, setShopTab] = useState<"upgrades" | "exchange" | "history" | "inventory" | "marketplace">("upgrades");
  const [hasCheckedInToday, setHasCheckedInToday] = useState(() => {
    const lastCheckin = localStorage.getItem("pioneer_last_checkin");
    return lastCheckin === new Date().toDateString();
  });

  const playerName = piUser?.username || `Pioneer_${playerId.substring(7, 12)}`;

  const marketplaceListings = [
    ...cloudListings.filter((l) => l.status !== "claimed").map((l) => ({
      ...l,
      seller: l.sellerId === playerId ? "player" : (l.sellerName || l.seller || "Pioneer")
    })),
    ...npcListings
  ];

  const [transactions, setTransactions] = useState<PiTransaction[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("pioneer_pi_transactions");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          return [];
        }
      }
    }
    return [];
  });

  const logTransaction = (tx: Partial<PiTransaction>) => {
    setTransactions((prev) => {
      const existingIdx = prev.findIndex((t) => t.id === tx.id);
      let next: PiTransaction[];
      if (existingIdx > -1) {
        const existingTx = prev[existingIdx];
        if (existingTx.status === "success" && tx.status && tx.status !== "success") {
          console.log(`[Pi SDK] Ignoring status downgrade for transaction ${tx.id} from success to ${tx.status}`);
          const updatedTx = { ...existingTx, ...tx, status: existingTx.status, simulated: existingTx.simulated || tx.simulated };
          next = [...prev];
          next[existingIdx] = updatedTx as PiTransaction;
        } else {
          next = [...prev];
          next[existingIdx] = { ...next[existingIdx], ...tx } as PiTransaction;
        }
      } else {
        const newTx: PiTransaction = {
          id: tx.id || `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: tx.type || "deposit",
          amountCoins: tx.amountCoins || 0,
          piAmount: tx.piAmount || 0,
          status: tx.status || "pending",
          timestamp: tx.timestamp || Date.now(),
          txid: tx.txid,
          memo: tx.memo,
          simulated: tx.simulated
        };
        next = [newTx, ...prev];
      }
      localStorage.setItem("pioneer_pi_transactions", JSON.stringify(next));
      return next;
    });
  };

  // ==========================================
  // PROCEDURAL LOOT & EQUIPMENT HELPERS
  // ==========================================
  const generateRandomEquipment = (rarityRoll?: number) => {
    const roll = rarityRoll !== undefined ? rarityRoll : Math.random() * 100;
    let rarity: "common" | "rare" | "epic" | "legendary" = "common";
    if (roll > 96) rarity = "legendary";
    else if (roll > 82) rarity = "epic";
    else if (roll > 55) rarity = "rare";

    const types: ("weapon" | "armor" | "accessory")[] = ["weapon", "armor", "accessory"];
    const type = types[Math.floor(Math.random() * types.length)];

    let name = "";
    let statType: "damage" | "health" | "speed" | "regen" | "magnet" = "damage";
    let value = 0;
    let sellPrice = 1000;

    if (type === "weapon") {
      const weaponNames = {
        common: ["Plasma Sơ Cấp", "Súng Phun Lửa Cũ", "Dao Găm Năng Lượng"],
        rare: ["Súng Laser Tần Số", "Kiếm Quang Tinh Thể", "Pháo Plasma Cải Tiến"],
        epic: ["Súng Điện Từ Tesla", "Trọng Lực Kiếm Vô Cực", "Tia Chớp Phân Hủy"],
        legendary: ["Vũ Khí Hủy Diệt Pioneer", "Thần Binh Antipi", "Pháo Cổ Độc Bản"]
      };
      name = weaponNames[rarity][Math.floor(Math.random() * weaponNames[rarity].length)];
      statType = "damage";
      
      if (rarity === "common") value = Math.floor(5 + Math.random() * 6); // +5% to +10%
      else if (rarity === "rare") value = Math.floor(11 + Math.random() * 10); // +11% to +20%
      else if (rarity === "epic") value = Math.floor(21 + Math.random() * 15); // +21% to +35%
      else value = Math.floor(36 + Math.random() * 25); // +36% to +60%
      
      sellPrice = rarity === "common" ? 1500 : rarity === "rare" ? 3000 : rarity === "epic" ? 7500 : 18000;
    } else if (type === "armor") {
      const armorNames = {
        common: ["Áo Da Thám Hiểm", "Giáp Sợi Carbon", "Lá Chắn Từ Trường Nhẹ"],
        rare: ["Áo Giáp Thép Titanium", "Khiên Năng Lượng Đa Lớp", "Áo Khoác Sợi Polyme"],
        epic: ["Giáp Nano Phục Hồi", "Lá Chắn Trọng Lực Kép", "Áo Choàng Bóng Tối"],
        legendary: ["Giáp Hạt Nhân Tối Thượng", "Khiên Thần Chống Đạn", "Áo Giáp Sinh Học Thần Thánh"]
      };
      name = armorNames[rarity][Math.floor(Math.random() * armorNames[rarity].length)];
      statType = Math.random() > 0.5 ? "health" : "regen";
      
      if (statType === "health") {
        if (rarity === "common") value = Math.floor(10 + Math.random() * 11);
        else if (rarity === "rare") value = Math.floor(21 + Math.random() * 20);
        else if (rarity === "epic") value = Math.floor(41 + Math.random() * 40);
        else value = Math.floor(81 + Math.random() * 100);
      } else {
        if (rarity === "common") value = parseFloat((0.1 + Math.random() * 0.2).toFixed(2));
        else if (rarity === "rare") value = parseFloat((0.31 + Math.random() * 0.4).toFixed(2));
        else if (rarity === "epic") value = parseFloat((0.71 + Math.random() * 0.8).toFixed(2));
        else value = parseFloat((1.51 + Math.random() * 1.5).toFixed(2));
      }
      
      sellPrice = rarity === "common" ? 1200 : rarity === "rare" ? 2500 : rarity === "epic" ? 6500 : 15000;
    } else {
      const accessoryNames = {
        common: ["Vòng Đeo Chân Động Cơ", "Nhẫn Nam Châm Sơ Cấp", "Găng Tay Tiện Ích"],
        rare: ["Kính Nhìn Đêm Siêu Quang", "Vòng Tay Động Lực", "Giầy Bay Phản Lực"],
        epic: ["Trái Tim Nhân Tạo Siêu Tải", "Cánh Bướm Phản Vật Chất", "Nhẫn Từ Trường Vũ Trụ"],
        legendary: ["Đồng Hồ Du Hành Thời Gian", "Mũ Bảo Hiểm Vô Cực", "Huy Chương Danh Dự Pioneer"]
      };
      name = accessoryNames[rarity][Math.floor(Math.random() * accessoryNames[rarity].length)];
      statType = Math.random() > 0.5 ? "speed" : "magnet";

      if (statType === "speed") {
        if (rarity === "common") value = Math.floor(3 + Math.random() * 5);
        else if (rarity === "rare") value = Math.floor(8 + Math.random() * 8);
        else if (rarity === "epic") value = Math.floor(16 + Math.random() * 10);
        else value = Math.floor(26 + Math.random() * 15);
      } else {
        if (rarity === "common") value = Math.floor(15 + Math.random() * 16);
        else if (rarity === "rare") value = Math.floor(31 + Math.random() * 30);
        else if (rarity === "epic") value = Math.floor(61 + Math.random() * 40);
        else value = Math.floor(101 + Math.random() * 100);
      }
      
      sellPrice = rarity === "common" ? 1000 : rarity === "rare" ? 2200 : rarity === "epic" ? 5500 : 13000;
    }

    sellPrice = Math.floor(sellPrice * (0.9 + Math.random() * 0.2));

    return {
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      type,
      rarity,
      statType,
      value,
      sellPrice
    };
  };

  const handleOpenGiftBox = () => {
    if (giftBoxes <= 0 || isOpeningBox) return;

    setIsOpeningBox(true);
    setOpenedReward(null);
    playSfx("shoot");

    setGiftBoxes((prev) => {
      const next = Math.max(0, prev - 1);
      localStorage.setItem("pioneer_gift_boxes", String(next));
      return next;
    });

    setTimeout(() => {
      // Ad impression generates 1,000 coins (0.001 Pi equivalent).
      // Gift box reward must be strictly lower than ad impression value (e.g., 400 - 800 gold coins).
      const coinReward = Math.floor(400 + Math.random() * 401); // guarantee 400 - 800 gold coins (average 600)
      let itemReward: any = null;
      if (Math.random() < 0.35) { // 35% chance to roll item
        itemReward = generateRandomEquipment();
      }

      setMetaGold((prev) => {
        const next = prev + coinReward;
        localStorage.setItem("pioneer_meta_gold", String(next));
        return next;
      });

      if (itemReward) {
        setInventory((prev) => {
          const next = [...prev, itemReward];
          localStorage.setItem("pioneer_inventory", JSON.stringify(next));
          return next;
        });
      }

      playSfx("levelup");
      setOpenedReward({
        coins: coinReward,
        item: itemReward
      });
      setIsOpeningBox(false);
    }, 1200);
  };

  const handleEquipItem = (item: any) => {
    if (item.type === "weapon") {
      setEquippedWeapon(item);
      localStorage.setItem("pioneer_equipped_weapon", JSON.stringify(item));
    } else if (item.type === "armor") {
      setEquippedArmor(item);
      localStorage.setItem("pioneer_equipped_armor", JSON.stringify(item));
    } else if (item.type === "accessory") {
      setEquippedAccessory(item);
      localStorage.setItem("pioneer_equipped_accessory", JSON.stringify(item));
    }
    playSfx("upgrade");
  };

  const handleUnequipItem = (type: "weapon" | "armor" | "accessory") => {
    if (type === "weapon") {
      setEquippedWeapon(null);
      localStorage.removeItem("pioneer_equipped_weapon");
    } else if (type === "armor") {
      setEquippedArmor(null);
      localStorage.removeItem("pioneer_equipped_armor");
    } else if (type === "accessory") {
      setEquippedAccessory(null);
      localStorage.removeItem("pioneer_equipped_accessory");
    }
    playSfx("hurt");
  };

  const handlePostListing = async (item: any, priceInput: number) => {
    const isWpnEquipped = equippedWeapon?.id === item.id;
    const isArmEquipped = equippedArmor?.id === item.id;
    const isAccEquipped = equippedAccessory?.id === item.id;

    if (isWpnEquipped || isArmEquipped || isAccEquipped) {
      alert(language === "vi" ? "Vui lòng tháo trang bị trước khi treo bán!" : "Please unequip before posting for sale!");
      return;
    }

    if (priceInput <= 0 || isNaN(priceInput)) {
      alert(language === "vi" ? "Giá bán không hợp lệ!" : "Invalid price!");
      return;
    }

    const listId = `list-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newListing = {
      id: listId,
      item,
      price: priceInput,
      sellerId: playerId,
      sellerName: playerName,
      status: "listed"
    };

    setInventory((prev) => {
      const next = prev.filter((i) => i.id !== item.id);
      localStorage.setItem("pioneer_inventory", JSON.stringify(next));
      return next;
    });

    try {
      await setDoc(doc(db, "pioneer_marketplace", listId), newListing);
    } catch (e) {
      console.error("Failed to post listing to Firestore:", e);
    }

    playSfx("upgrade");
  };

  const getBuybackPrice = (rarity: string) => {
    if (rarity === "rare") return 150;
    if (rarity === "epic") return 200;
    if (rarity === "legendary") return 250;
    return 100; // common
  };

  const handleBuybackItem = (item: any) => {
    const isWpnEquipped = equippedWeapon?.id === item.id;
    const isArmEquipped = equippedArmor?.id === item.id;
    const isAccEquipped = equippedAccessory?.id === item.id;

    if (isWpnEquipped || isArmEquipped || isAccEquipped) {
      alert(language === "vi" ? "Vui lòng tháo trang bị trước khi bán cho hệ thống!" : "Please unequip before selling to system!");
      return;
    }

    const price = getBuybackPrice(item.rarity);

    setInventory((prev) => {
      const next = prev.filter((i) => i.id !== item.id);
      localStorage.setItem("pioneer_inventory", JSON.stringify(next));
      return next;
    });

    setMetaGold((prev) => {
      const next = prev + price;
      localStorage.setItem("pioneer_meta_gold", String(next));
      return next;
    });

    playSfx("upgrade");
  };

  const handleClaimSoldListing = async (listingId: string, goldPrice: number) => {
    setMetaGold((prev) => {
      const next = prev + goldPrice;
      localStorage.setItem("pioneer_meta_gold", String(next));
      return next;
    });

    try {
      await deleteDoc(doc(db, "pioneer_marketplace", listingId));
    } catch (e) {
      console.error("Failed to claim sold listing from Firestore:", e);
    }

    playSfx("upgrade");
  };

  const handleCancelListing = async (listing: any) => {
    setInventory((prev) => {
      const next = [...prev, listing.item];
      localStorage.setItem("pioneer_inventory", JSON.stringify(next));
      return next;
    });

    try {
      await deleteDoc(doc(db, "pioneer_marketplace", listing.id));
    } catch (e) {
      console.error("Failed to cancel listing from Firestore:", e);
    }

    playSfx("hurt");
  };

  const handleBuyListing = async (listing: any) => {
    if (metaGold < listing.price) {
      alert(language === "vi" ? "Không đủ xu vàng!" : "Not enough gold coins!");
      return;
    }

    if (listing.id.startsWith("list-npc") || !listing.sellerId) {
      // NPC listing
      setMetaGold((prev) => {
        const next = prev - listing.price;
        localStorage.setItem("pioneer_meta_gold", String(next));
        return next;
      });

      setInventory((prev) => {
        const next = [...prev, listing.item];
        localStorage.setItem("pioneer_inventory", JSON.stringify(next));
        return next;
      });

      setNpcListings((prev) => {
        const next = prev.filter((l) => l.id !== listing.id);
        localStorage.setItem("pioneer_npc_listings", JSON.stringify(next));
        return next;
      });

      playSfx("upgrade");
      return;
    }

    // Real player listing
    setMetaGold((prev) => {
      const next = prev - listing.price;
      localStorage.setItem("pioneer_meta_gold", String(next));
      return next;
    });

    setInventory((prev) => {
      const next = [...prev, listing.item];
      localStorage.setItem("pioneer_inventory", JSON.stringify(next));
      return next;
    });

    try {
      await updateDoc(doc(db, "pioneer_marketplace", listing.id), {
        status: "sold",
        buyerId: playerId,
        buyerName: playerName
      });
    } catch (e) {
      console.error("Failed to buy listing in Firestore:", e);
    }

    playSfx("upgrade");
  };

  const handleRefreshMarketplace = () => {
    if (isRefreshingMarketplace) return;
    
    setIsRefreshingMarketplace(true);
    playSfx("upgrade");

    setTimeout(() => {
      // Generate 3-5 new public listings for NPCs
      const mockSellers = [
        "SpaceWalker_Pi", "Pioneer_X", "Antipi_Expert", "PiKnight", 
        "Genesis_Pioneer", "CyberPioneer", "Pi_Nebula", "Alpha_Miner", 
        "CryptoSurvivor", "QuantumExplorer"
      ];

      const newPublicListings: any[] = [];
      const numItems = 3 + Math.floor(Math.random() * 3); // 3 to 5 items

      for (let i = 0; i < numItems; i++) {
        const item = generateRandomEquipment();
        // Determine a reasonable price factor based on rarity
        const priceMultiplier = 1.0 + Math.random() * 0.5; // 100% to 150% of the sell price
        const price = Math.floor(item.sellPrice * priceMultiplier);
        const seller = mockSellers[Math.floor(Math.random() * mockSellers.length)];

        newPublicListings.push({
          id: `list-npc-${Date.now()}-${i}-${Math.random()}`,
          item,
          price,
          seller,
          sold: false,
          status: "listed"
        });
      }

      setNpcListings(newPublicListings);
      localStorage.setItem("pioneer_npc_listings", JSON.stringify(newPublicListings));
      
      setIsRefreshingMarketplace(false);
    }, 800);
  };

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

  // Real-time synchronization of decentralized marketplace listings with Firestore
  useEffect(() => {
    const colRef = collection(db, "pioneer_marketplace");
    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      const items: any[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() });
      });
      setCloudListings(items);
    }, (error) => {
      console.error("Firestore listener error:", error);
    });
    return () => unsubscribe();
  }, []);

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
    aiDirector: {
      intensity: 1.0,
      dodgeCloseCalls: 0,
      damageTakenInWindow: 0,
      killsInWindow: 0,
      lastEvaluationTime: 0,
      playstyleLabel: "Cân bằng",
      adjustmentReason: "Ổn định",
      activityScore: 50,
      directionChanges: 0,
      stationaryTicks: 0,
      movingTicks: 0,
      lastMoveAngle: null as number | null,
    },
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

    // Calculate equipped items bonuses
    let weaponDmgBonus = 0;
    if (equippedWeapon && equippedWeapon.statType === "damage") {
      weaponDmgBonus = (equippedWeapon.value / 100);
    }

    let armorHpBonus = 0;
    let armorRegenBonus = 0;
    if (equippedArmor) {
      if (equippedArmor.statType === "health") armorHpBonus = equippedArmor.value;
      if (equippedArmor.statType === "regen") armorRegenBonus = equippedArmor.value;
    }

    let accSpeedBonus = 0;
    let accMagnetBonus = 0;
    if (equippedAccessory) {
      if (equippedAccessory.statType === "speed") accSpeedBonus = (equippedAccessory.value / 100) * 1.8;
      if (equippedAccessory.statType === "magnet") accMagnetBonus = equippedAccessory.value;
    }

    // Apply permanent stats from shop + equipment bonuses
    const baseMaxHp = 100 + shopUpgrades.health * 15 + armorHpBonus;
    const baseSpeed = 1.8 + shopUpgrades.speed * 0.18 + accSpeedBonus;
    const baseDamage = 1.0 + shopUpgrades.damage * 0.15 + weaponDmgBonus;
    const baseMagnet = 100 + shopUpgrades.magnet * 25 + accMagnetBonus;
    const baseRegen = shopUpgrades.regen * 0.35 + armorRegenBonus;

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
        gold: 0, // This counts collected Gift Boxes in the run
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
      aiDirector: {
        intensity: 1.0,
        dodgeCloseCalls: 0,
        damageTakenInWindow: 0,
        killsInWindow: 0,
        lastEvaluationTime: 0,
        playstyleLabel: "Cân bằng",
        adjustmentReason: "Ổn định",
        activityScore: 50,
        directionChanges: 0,
        stationaryTicks: 0,
        movingTicks: 0,
        lastMoveAngle: null as number | null,
      },
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
      aiIntensity: 1.0,
      aiPlaystyle: "Cân bằng",
      aiAdjustment: "Ổn định",
      aiActivityScore: 50,
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
    type: "REROLL" | "REVIVE" | "DOUBLE_GOLD" | "DAILY_CHECKIN",
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
        
        // Track the doubled gold towards the daily grind limit
        setDailyGrindGold((current) => {
          const next = current + addedGold;
          try {
            const today = new Date().toDateString();
            localStorage.setItem("pioneer_daily_grind_gold", JSON.stringify({
              date: today,
              amount: next
            }));
          } catch (e) {
            console.error(e);
          }
          return next;
        });

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

  const handleDailyCheckIn = () => {
    if (hasCheckedInToday) return;

    triggerAdFlow("DAILY_CHECKIN", language === "vi" ? "Đang phát sóng quảng cáo điểm danh..." : "Loading check-in broadcast...", () => {
      setMetaGold((prev: number) => {
        const next = prev + 1000;
        localStorage.setItem("pioneer_meta_gold", String(next));
        return next;
      });
      localStorage.setItem("pioneer_last_checkin", new Date().toDateString());
      setHasCheckedInToday(true);
      playSfx("upgrade");
      
      logTransaction({
        id: `checkin-${Date.now()}`,
        type: "deposit",
        amountCoins: 1000,
        piAmount: 0,
        status: "success",
        timestamp: Date.now(),
        memo: language === "vi" ? "Điểm danh hàng ngày (+1,000 xu)" : "Daily Check-in (+1,000 coins)"
      });
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

      // 2. Perform Pi.authenticate using the 'username', 'payments', and 'wallet_address' scopes and handle incomplete payments
      console.log("[Pi SDK] Initiating Pi.authenticate...");
      const auth = await Pi.authenticate(["username", "payments", "wallet_address"], (incompletePayment: any) => {
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
      const piAmount = parseFloat((cost * 0.000001).toFixed(6));
      setPiPaymentStatus("creating");
      setPiPaymentError("");

      try {
        const Pi = (window as any).Pi;
        Pi.createPayment(
          {
            amount: piAmount,
            memo: `Pioneer Upgrade: ${key === "damage" ? t("plasmaAccelerators") : key === "health" ? t("nanoshieldArmor") : key === "speed" ? t("reactorThrusters") : key === "magnet" ? t("quantumHarvester") : t("naniteRepairSystems")} (${t("hudLevel")} ${shopUpgrades[key] + 1})`,
            metadata: { upgradeKey: key, targetLevel: shopUpgrades[key] + 1 },
          },
          {
            onReadyForServerApproval: (paymentId: string) => {
              console.log(`[Pi SDK] Payment ${paymentId} ready for server approval...`);
              setPiPaymentStatus("approving");
              
              logTransaction({
                id: paymentId,
                type: "upgrade_purchase",
                amountCoins: cost,
                piAmount: piAmount,
                status: "pending",
                timestamp: Date.now(),
                memo: `Upgrade ${key === "damage" ? t("plasmaAccelerators") : key === "health" ? t("nanoshieldArmor") : key === "speed" ? t("reactorThrusters") : key === "magnet" ? t("quantumHarvester") : t("naniteRepairSystems")} (${t("hudLevel")} ${shopUpgrades[key] + 1})`
              });

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
                  throw new Error(t("apiErrorNoHtml"));
                })
                .then((data) => {
                  console.log("[Pi SDK] Server approved payment successfully:", data);
                })
                .catch((err: any) => {
                  console.warn("[Pi SDK] Server approval failed:", err);
                  setPiPaymentStatus("error");
                  setPiPaymentError(err?.message || t("checkoutProtocolError"));
                  logTransaction({
                    id: paymentId,
                    status: "failed"
                  });
                });
            },
            onReadyForServerCompletion: (paymentId: string, txid: string) => {
              console.log(`[Pi SDK] Payment ${paymentId} signed on blockchain, ready for completion...`);
              setPiPaymentStatus("completing");

              logTransaction({
                id: paymentId,
                txid
              });

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
                  throw new Error(t("apiErrorGeneric"));
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
                  
                  logTransaction({
                    id: paymentId,
                    status: "success"
                  });

                  // Clear success state after 3 seconds
                  setTimeout(() => setPiPaymentStatus("idle"), 3000);
                })
                .catch((err) => {
                  console.warn("[Pi SDK] Server completion failed:", err);
                  setPiPaymentStatus("error");
                  setPiPaymentError(t("processSellError"));
                  logTransaction({
                    id: paymentId,
                    status: "failed"
                  });
                });
            },
            onCancel: (paymentId: string) => {
              console.log("[Pi SDK] Payment cancelled by user:", paymentId);
              setPiPaymentStatus("cancelled");
              logTransaction({
                id: paymentId,
                status: "cancelled"
              });
              setTimeout(() => setPiPaymentStatus("idle"), 2500);
            },
            onError: (error: Error, payment: any) => {
              console.warn("[Pi SDK] Payment error:", error, payment);
              setPiPaymentStatus("error");
              setPiPaymentError(error.message || t("checkoutProtocolError"));
              logTransaction({
                id: payment?.identifier || `err-${Date.now()}`,
                status: "failed"
              });
              setTimeout(() => setPiPaymentStatus("idle"), 4000);
            }
          }
        );
      } catch (err: any) {
        console.warn("[Pi SDK] Error launching payment flow:", err);
        setPiPaymentStatus("error");
        setPiPaymentError(err.message || t("checkoutProtocolError"));
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
            memo: language === "vi" ? `Mua ${amountCoins} Xu (Thẻ kỹ thuật cơ sở) trong game Pioneer` : `Buy ${amountCoins} Coins (Base Engineering Credits) inside Pioneer`,
            metadata: { type: "buy_xu", amountCoins },
          },
          {
            onReadyForServerApproval: (paymentId: string) => {
              console.log(`[Pi SDK] Buy Xu payment ${paymentId} ready for server approval...`);
              setPiPaymentStatus("approving");
              
              logTransaction({
                id: paymentId,
                type: "deposit",
                amountCoins,
                piAmount,
                status: "pending",
                timestamp: Date.now(),
                memo: language === "vi" ? `Nạp ${amountCoins} Xu` : `Buy ${amountCoins} Coins`
              });

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
                  throw new Error(t("apiErrorGeneric"));
                })
                .then((data) => {
                  console.log("[Pi SDK] Server approved Buy Xu payment successfully:", data);
                })
                .catch((err: any) => {
                  console.warn("[Pi SDK] Server approval for Buy Xu failed:", err);
                  setPiPaymentStatus("error");
                  setPiPaymentError(err?.message || t("checkoutProtocolError"));
                  logTransaction({
                    id: paymentId,
                    status: "failed"
                  });
                });
            },
            onReadyForServerCompletion: (paymentId: string, txid: string) => {
              console.log(`[Pi SDK] Buy Xu payment ${paymentId} signed, ready for completion...`);
              setPiPaymentStatus("completing");

              logTransaction({
                id: paymentId,
                txid
              });

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
                  throw new Error(t("apiErrorGeneric"));
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
                  
                  logTransaction({
                    id: paymentId,
                    status: "success"
                  });

                  setTimeout(() => setPiPaymentStatus("idle"), 3000);
                })
                .catch((err) => {
                  console.warn("[Pi SDK] Server completion for Buy Xu failed:", err);
                  setPiPaymentStatus("error");
                  setPiPaymentError(t("checkoutProtocolError"));
                  logTransaction({
                    id: paymentId,
                    status: "failed"
                  });
                });
            },
            onCancel: (paymentId: string) => {
              console.log(`[Pi SDK] Buy Xu payment ${paymentId} cancelled by user.`);
              setPiPaymentStatus("cancelled");
              logTransaction({
                id: paymentId,
                status: "cancelled"
              });
              setTimeout(() => setPiPaymentStatus("idle"), 2500);
            },
            onError: (error: Error, payment?: any) => {
              console.error("[Pi SDK] Buy Xu payment error:", error, payment);
              setPiPaymentStatus("error");
              setPiPaymentError(error?.message || t("checkoutProtocolError"));
              logTransaction({
                id: payment?.identifier || `err-${Date.now()}`,
                status: "failed"
              });
              setTimeout(() => setPiPaymentStatus("idle"), 4000);
            }
          }
        );
      } catch (err: any) {
        console.warn("[Pi SDK] Failed to buy xu:", err);
        setPiPaymentStatus("error");
        setPiPaymentError(err?.message || t("checkoutProtocolError"));
        setTimeout(() => setPiPaymentStatus("idle"), 3000);
      }
    } else {
      // Local/Sandbox Mode purchase of xu
      setPiPaymentStatus("creating");
      const sandboxId = `sandbox-${Date.now()}`;
      logTransaction({
        id: sandboxId,
        type: "deposit",
        amountCoins,
        piAmount,
        status: "success",
        timestamp: Date.now(),
        simulated: true,
        memo: language === "vi" ? "Nạp Xu (Chế độ thử nghiệm local)" : "Sandbox Deposit"
      });
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
      setPiPaymentError(t("notEnoughCoinsToSell", { amount: amountCoins }));
      return;
    }

    if (!piUser) {
      setPiPaymentError(t("loginPiWalletToSell"));
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
        let errorMsg = t("sellRejected");
        if (isJson) {
          const errorData = await res.json();
          errorMsg = errorData.error || errorMsg;
        } else {
          errorMsg = t("apiErrorGeneric");
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
        
        logTransaction({
          id: data.paymentId || `wd-${Date.now()}`,
          type: "withdrawal",
          amountCoins: amountCoins,
          piAmount: piAmount,
          status: "success",
          timestamp: Date.now(),
          txid: data.txid,
          simulated: !!data.simulated,
          memo: data.simulated 
            ? (language === "vi" ? `Rút Pi (Chế độ mô phỏng)` : `Simulated Withdrawal`)
            : (language === "vi" ? `Rút Pi về ví thành công` : `Pi Wallet Withdrawal`)
        });

        if (data.simulated) {
          setPiPaymentStatus("success");
          setPiPaymentError(data.message || t("simulateNoWalletSeed", { amount: piAmount }));
        } else {
          setPiPaymentStatus("success");
          setPiPaymentError(`${piAmount} π`);
        }
      } else {
        throw new Error(t("invalidServerResponse"));
      }

      setTimeout(() => {
        setPiPaymentStatus("idle");
        setPiPaymentError("");
      }, 7000);
    } catch (err: any) {
      console.warn("[Pi SDK] Failed to sell xu:", err);
      setPiPaymentStatus("error");
      setPiPaymentError(err?.message || t("processSellError"));
      
      logTransaction({
        id: `wd-err-${Date.now()}`,
        type: "withdrawal",
        amountCoins: amountCoins,
        piAmount: piAmount,
        status: "failed",
        timestamp: Date.now(),
        memo: err?.message || "Withdrawal Failed"
      });

      setTimeout(() => setPiPaymentStatus("idle"), 4000);
    }
  };

  const resetSaveData = () => {
    const msg = language === "vi" ? "Bạn có chắc chắn muốn xóa toàn bộ chỉ số vĩnh viễn, kỷ lục và xu không?"
              : language === "zh" ? "您确定要清除所有永久属性、最高记录和金币吗？"
              : language === "es" ? "¿Está seguro de que desea restablecer todas las estadísticas permanentes, récords y monedas?"
              : language === "ko" ? "모든 영구 능력치, 최고 기록 및 골드를 초기화하시겠습니까?"
              : language === "ja" ? "すべての恒久ステータス、ハイスコア、ゴールドをリセットしてもよろしいですか？"
              : "Are you sure you want to reset all permanent stats, high scores, and gold?";
    if (confirm(msg)) {
      localStorage.clear();
      setMetaGold(0);
      setGiftBoxes(3);
      const starterWeapon = {
        id: "item-starter-wpn",
        name: "Súng Thám Hiểm Sơ Cấp",
        type: "weapon",
        rarity: "common",
        statType: "damage",
        value: 5,
        sellPrice: 10
      };
      setInventory([starterWeapon]);
      setEquippedWeapon(null);
      setEquippedArmor(null);
      setEquippedAccessory(null);
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

        // AI Director: Accumulate movement statistics
        engine.aiDirector.movingTicks += dt;
        const curAngle = Math.atan2(dy, dx);
        if (engine.aiDirector.lastMoveAngle !== null) {
          const diff = Math.abs(curAngle - engine.aiDirector.lastMoveAngle);
          // Register direction changes as zig-zag tactical movement
          if (diff > 0.6 && diff < 2.5) {
            engine.aiDirector.directionChanges += dt;
          }
        }
        engine.aiDirector.lastMoveAngle = curAngle;
      } else {
        engine.aiDirector.stationaryTicks += dt;
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
      // Spawn rate is dynamically adjusted by the AI Director intensity (lower spawn rate = faster spawns)
      let spawnRate = Math.max(20, (80 - Math.floor(engine.gameTime * 0.4)) / engine.aiDirector.intensity);
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

        // Scale hp and speed dynamically based on AI Director intensity
        const finalHp = Math.max(1, Math.floor(hp * Math.sqrt(engine.aiDirector.intensity)));
        const finalSpeed = speed * Math.sqrt(engine.aiDirector.intensity);

        engine.enemies.push({
          id: Math.random().toString(),
          x: enemyX,
          y: enemyY,
          hp: finalHp,
          maxHp: finalHp,
          speed: finalSpeed,
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

        // Close proximity dodge check (distance is close but they aren't colliding)
        if (edist < engine.player.size + enemy.size + 45 && edist >= engine.player.size + enemy.size) {
          if (moveDist > 0.1) {
            engine.aiDirector.dodgeCloseCalls += 0.016 * dt;
          }
        }

        // Player Collision Damage Check
        if (edist < engine.player.size + enemy.size) {
          const dmg = (enemy.type === "boss" ? 0.8 : enemy.type === "goliath" ? 0.4 : 0.15) * dt * Math.sqrt(engine.aiDirector.intensity);
          // Apply armor reduction from meta shop
          const armorReduction = shopUpgrades.regen * 0.05; // Use regen levels as minor armor reduction too
          const finalHit = Math.max(0.05, dmg * (1 - armorReduction));
          engine.player.hp -= finalHit;
          engine.aiDirector.damageTakenInWindow += finalHit;

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
          engine.aiDirector.killsInWindow += 1;

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

          // Randomize dropping Gift Boxes or XP Orbs
          const isBoss = e.type === "boss";
          
          // Drop rate for normal targets is 4% for a Gift Box. Boss is 100% guaranteed to drop a box!
          const isGold = isBoss ? true : Math.random() < 0.04;

          // Gift Box yields exactly 1 unopened package when collected
          const dropAmount = isGold ? 1 : e.points;

          engine.items.push({
            x: e.x,
            y: e.y,
            amount: dropAmount,
            size: isGold ? 5 : 3,
            color: isGold ? "#e11d48" : isBoss ? "#d946ef" : "#10b981", // vibrant red for Gift Box, magenta for boss, green for standard xp
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
              text: language === "vi" ? `+1 Hộp Quà 🎁` : `+1 Gift Box 🎁`,
              color: "#fb7185",
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

      // ==========================================
      // AI ADAPTIVE DIFFICULTIES SYSTEM EVALUATOR
      // ==========================================
      if (engine.gameTime - engine.aiDirector.lastEvaluationTime >= 3.0) {
        const totalTicks = engine.aiDirector.movingTicks + engine.aiDirector.stationaryTicks || 1;
        const moveRatio = engine.aiDirector.movingTicks / totalTicks;
        const zigzagRatio = engine.aiDirector.directionChanges / totalTicks;
        const dodgeRate = engine.aiDirector.dodgeCloseCalls;

        // Calculate active gameplay score (0 to 100)
        let activityScore = 50;
        if (moveRatio > 0.75) activityScore += 15;
        if (moveRatio < 0.2) activityScore -= 15;
        activityScore += Math.min(dodgeRate * 8, 25);
        activityScore += Math.min(zigzagRatio * 150, 15);
        activityScore -= Math.min(engine.aiDirector.damageTakenInWindow * 1.5, 25);
        activityScore = Math.max(0, Math.min(100, activityScore));
        engine.aiDirector.activityScore = activityScore;

        // Dynamic playstyle profile labels based on metrics and selected language
        let label = "Cân bằng";
        if (language === "vi") {
          if (moveRatio < 0.25) label = "Bất động (Thủ)";
          else if (dodgeRate > 2.0 && moveRatio > 0.6) label = "Siêu né (Pro)";
          else if (zigzagRatio > 0.12) label = "Tấn công (Nhanh)";
          else if (moveRatio > 0.8) label = "Năng động";
          else label = "Cân bằng";
        } else if (language === "zh") {
          if (moveRatio < 0.25) label = "站桩防守";
          else if (dodgeRate > 2.0 && moveRatio > 0.6) label = "极限微操闪避";
          else if (zigzagRatio > 0.12) label = "蛇形激进型";
          else if (moveRatio > 0.8) label = "高频活跃移动";
          else label = "均衡发展";
        } else if (language === "es") {
          if (moveRatio < 0.25) label = "Fijo (Defensivo)";
          else if (dodgeRate > 2.0 && moveRatio > 0.6) label = "Esquivador Pro";
          else if (zigzagRatio > 0.12) label = "Agresivo (Zigzag)";
          else if (moveRatio > 0.8) label = "Muy Activo";
          else label = "Equilibrado";
        } else if (language === "ko") {
          if (moveRatio < 0.25) label = "정지수비형";
          else if (dodgeRate > 2.0 && moveRatio > 0.6) label = "극한회피프로";
          else if (zigzagRatio > 0.12) label = "돌격지그재그";
          else if (moveRatio > 0.8) label = "기동형";
          else label = "균형잡힌";
        } else if (language === "ja") {
          if (moveRatio < 0.25) label = "固定防衛";
          else if (dodgeRate > 2.0 && moveRatio > 0.6) label = "極限微回避プロ";
          else if (zigzagRatio > 0.12) label = "ジグザグアタック";
          else if (moveRatio > 0.8) label = "アクティブ移動";
          else label = "バランス";
        } else {
          if (moveRatio < 0.25) label = "Stationary (Defense)";
          else if (dodgeRate > 2.0 && moveRatio > 0.6) label = "Micro-Dodge Pro";
          else if (zigzagRatio > 0.12) label = "Aggressive (Zigzag)";
          else if (moveRatio > 0.8) label = "Highly Active";
          else label = "Balanced";
        }
        engine.aiDirector.playstyleLabel = label;

        // Set intensity adjust reason & values
        let nextIntensity = 1.0;
        let reason = "Ổn định";

        const currentHpPercent = (engine.player.hp / engine.player.maxHp) * 100;

        if (currentHpPercent < 30) {
          nextIntensity = 0.5;
          reason = language === "vi" ? "Trợ lực HP thấp" :
                   language === "zh" ? "低生命值援助" :
                   language === "es" ? "Soporte Vida Baja" :
                   language === "ko" ? "체력 지원" :
                   language === "ja" ? "低HP救済" : "Low HP Aid";

          // EMERGENCY INTERVENTION: Drop healing items near the player if none exist
          const nearRepair = engine.items.some(it => it.type === "repair" && Math.sqrt(Math.pow(it.x - engine.player.x, 2) + Math.pow(it.y - engine.player.y, 2)) < 300);
          if (!nearRepair && Math.random() < 0.6) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 120 + Math.random() * 60;
            engine.items.push({
              id: "ai_emergency_" + Math.random().toString(),
              x: engine.player.x + Math.cos(angle) * dist,
              y: engine.player.y + Math.sin(angle) * dist,
              type: "repair",
              amount: 25,
            });
            engine.damageTexts.push({
              x: engine.player.x,
              y: engine.player.y - 45,
              text: language === "vi" ? "HỖ TRỢ AI: CẤP THIẾT BỊ HỒI HP!" : "AI SUPPORT: NANITE DROP ACTIVATED!",
              color: "#34d399",
              alpha: 1,
              vy: -0.6
            });
          }
        } else if (engine.aiDirector.damageTakenInWindow > 25) {
          nextIntensity = 0.75;
          reason = language === "vi" ? "Giảm tải quái vật" :
                   language === "zh" ? "怪物减载" :
                   language === "es" ? "Menos Enemigos" :
                   language === "ko" ? "몬스터 완화" :
                   language === "ja" ? "敵スポーン減" : "Reducing Swarm";
        } else if (engine.aiDirector.damageTakenInWindow === 0 && engine.aiDirector.killsInWindow >= 8) {
          nextIntensity = 1.45;
          reason = language === "vi" ? "Thử thách cực hạn" :
                   language === "zh" ? "极限挑战" :
                   language === "es" ? "Máximo Desafío" :
                   language === "ko" ? "최대 도전" :
                   language === "ja" ? "極限チャレンジ" : "Challenging Elite";
        } else if (engine.aiDirector.damageTakenInWindow === 0 && engine.aiDirector.killsInWindow >= 4) {
          nextIntensity = 1.2;
          reason = language === "vi" ? "Tăng áp lực" :
                   language === "zh" ? "增加压力" :
                   language === "es" ? "Más Tensión" :
                   language === "ko" ? "난이도 상승" :
                   language === "ja" ? "難易度上昇" : "Escalating Swarm";
        } else if (moveRatio > 0.8 && engine.aiDirector.killsInWindow > 0) {
          nextIntensity = 1.1;
          reason = language === "vi" ? "Thích ứng di chuyển" :
                   language === "zh" ? "移动适应中" :
                   language === "es" ? "Ritmo Activo" :
                   language === "ko" ? "움직임 적응" :
                   language === "ja" ? "アクティブ対応" : "Adaptive Pace";
        } else {
          nextIntensity = 1.0;
          reason = language === "vi" ? "Tối ưu ổn định" :
                   language === "zh" ? "状态稳定" :
                   language === "es" ? "Ritmo Estable" :
                   language === "ko" ? "안정 유지" :
                   language === "ja" ? "安定フロー" : "Optimal Flow";
        }

        engine.aiDirector.intensity = nextIntensity;
        engine.aiDirector.adjustmentReason = reason;

        // Reset evaluation window metrics
        engine.aiDirector.dodgeCloseCalls = 0;
        engine.aiDirector.damageTakenInWindow = 0;
        engine.aiDirector.killsInWindow = 0;
        engine.aiDirector.directionChanges = 0;
        engine.aiDirector.movingTicks = 0;
        engine.aiDirector.stationaryTicks = 0;
        engine.aiDirector.lastEvaluationTime = engine.gameTime;
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

        const earnedBoxes = engine.player.gold;

        // Credit unopened gift boxes permanently
        setGiftBoxes((g) => {
          const next = g + earnedBoxes;
          localStorage.setItem("pioneer_gift_boxes", String(next));
          return next;
        });

        // Save High Scores
        const finalTime = timeStr;
        const finalKills = engine.player.kills;
        const finalLevel = engine.player.level;

        setFinalStats({
          time: finalTime,
          kills: finalKills,
          gold: earnedBoxes,
          level: finalLevel,
          unlockedGold: earnedBoxes
        });

        setHighScores((prev) => {
          const next = [
            ...prev,
            {
              time: finalTime,
              kills: finalKills,
              gold: earnedBoxes,
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

      // Draw XP/Gold items (XP is green, Gold is a beautiful Gift Box!)
      engine.items.forEach((item) => {
        const itemX = item.x - engine.player.x + cx;
        const itemY = item.y - engine.player.y + cy;

        ctx.shadowBlur = 10;
        ctx.shadowColor = item.color;

        if (item.isGold) {
          // Draw a gorgeous little Gift Box!
          const size = 11;
          ctx.fillStyle = "#e11d48"; // vibrant crimson package body
          ctx.fillRect(itemX - size / 2, itemY - size / 2, size, size);

          // Yellow/Gold ribbons
          ctx.fillStyle = "#fbbf24";
          ctx.fillRect(itemX - 1.5, itemY - size / 2, 3, size); // vertical ribbon
          ctx.fillRect(itemX - size / 2, itemY - 1.5, size, 3); // horizontal ribbon

          // Tiny ribbon bow loops on top
          ctx.beginPath();
          ctx.arc(itemX - 2.2, itemY - size / 2 - 1, 2.2, 0, Math.PI * 2);
          ctx.arc(itemX + 2.2, itemY - size / 2 - 1, 2.2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Circular XP Orbs
          ctx.fillStyle = item.color;
          ctx.beginPath();
          ctx.arc(itemX, itemY, item.size, 0, Math.PI * 2);
          ctx.fill();
        }
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
          aiIntensity: engine.aiDirector.intensity,
          aiPlaystyle: engine.aiDirector.playstyleLabel,
          aiAdjustment: engine.aiDirector.adjustmentReason,
          aiActivityScore: Math.round(engine.aiDirector.activityScore),
        });
      }

      animId = requestAnimationFrame(gameLoop);
    };

    animId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animId);
  }, [gameState, language]);

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
    <div className="h-[100dvh] w-full bg-brand-bg text-slate-800 font-sans flex flex-col items-center justify-center p-0 md:p-4 relative overflow-hidden select-none geometric-grid">
      {/* Absolute Aesthetic Background Glow Elements */}
      <div className="absolute top-1/4 left-1/4 w-80 h-80 rounded-full bg-brand-accent/5 blur-3xl pointer-events-none pulse-grid"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-indigo-500/5 blur-3xl pointer-events-none pulse-grid"></div>

      {/* Main Container constrained to 9:16 optimized viewport on desktop, full screen on mobile */}
      <div
        ref={containerRef}
        className="w-full h-full md:h-[84vh] md:max-w-[440px] md:aspect-[9/16] bg-brand-card rounded-none md:rounded-2xl border-0 md:border-2 border-brand-border shadow-none md:shadow-2xl flex flex-col relative overflow-hidden"
      >
        {/* Geometric Calibration Crosshairs on Corners */}
        <div className="absolute top-2.5 left-2.5 text-[10px] font-mono text-brand-muted/20 pointer-events-none select-none">+</div>
        <div className="absolute top-2.5 right-2.5 text-[10px] font-mono text-brand-muted/20 pointer-events-none select-none">+</div>
        <div className="absolute bottom-2.5 left-2.5 text-[10px] font-mono text-brand-muted/20 pointer-events-none select-none">+</div>
        <div className="absolute bottom-2.5 right-2.5 text-[10px] font-mono text-brand-muted/20 pointer-events-none select-none">+</div>

        {/* ==========================================
            AUDIO & PERFORMANCES HUD & LANGUAGE SELECTOR
            ========================================== */}
        <button
          onClick={toggleMute}
          className="absolute top-4 left-4 z-40 p-2 bg-brand-card border border-brand-border hover:border-brand-accent/40 rounded-lg cursor-pointer text-brand-muted transition geo-shadow-sm"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-rose-500" /> : <Volume2 className="w-4 h-4 text-brand-accent" />}
        </button>

        {/* Language Selection Dropdown */}
        <div className="absolute top-4 right-4 z-40">
          <select
            value={language}
            onChange={(e) => changeLanguage(e.target.value as Language)}
            className="appearance-none bg-brand-card border border-brand-border hover:border-brand-accent/40 rounded-lg px-2.5 py-1.5 text-[10px] font-bold font-mono text-slate-700 cursor-pointer transition geo-shadow-sm focus:outline-none focus:ring-1 focus:ring-brand-accent"
          >
            {languages.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.flag} {lang.name}
              </option>
            ))}
          </select>
        </div>

        {/* ==========================================
            1. START SCREEN LAYOUT
            ========================================== */}
        {gameState === "START" && (
          <div className="absolute inset-0 z-30 flex flex-col justify-between p-6 overflow-y-auto bg-gradient-to-b from-slate-50 via-brand-card to-slate-100">
            {/* Title Block */}
            <div className="text-center mt-6">
              <div className="flex items-center justify-center space-x-1.5 text-brand-accent font-bold tracking-widest text-[9px] uppercase mb-1 font-mono">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t("appSubtitle")}</span>
              </div>
              <h1 className="text-4xl font-extrabold tracking-tighter text-slate-800 font-display uppercase leading-none">
                {t("appTitle")}
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
                {t("unitStatusCalibrated")}
              </div>
            </div>

            {/* Play & Info Buttons */}
            <div className="space-y-3 px-1">
              <button
                onClick={startNewGame}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/20 text-white font-bold rounded-xl flex items-center justify-center space-x-2 transition cursor-pointer geo-shadow-indigo active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
              >
                <Play className="w-4 h-4 fill-current text-white" />
                <span className="font-display uppercase tracking-wider text-xs">{t("launchButton")}</span>
              </button>

              <button
                onClick={() => setShowTutorial(true)}
                className="w-full py-2.5 bg-brand-card border border-brand-border hover:bg-slate-50 text-slate-700 font-bold rounded-lg cursor-pointer flex items-center justify-center space-x-2 transition text-xs geo-shadow-sm"
              >
                <HelpCircle className="w-4 h-4 text-brand-accent" />
                <span className="font-display uppercase tracking-widest text-[10px]">{t("survivalProtocols")}</span>
              </button>
            </div>

            {/* Permanent Upgrades Matrix Shop */}
            <div className="bg-brand-card border border-brand-border rounded-xl p-3.5 my-2.5">
              
              {/* Pioneer Command Center Dashboard */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3.5 space-y-2.5">
                {/* Profile row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-7 h-7 rounded-full bg-indigo-100 border border-indigo-200 flex items-center justify-center font-bold text-indigo-700 text-[10px] font-mono shadow-sm">
                      {piUser ? piUser.username.substring(0, 2).toUpperCase() : "P"}
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-800 font-display leading-none">
                        {piUser ? `@${piUser.username}` : (language === "vi" ? "Phi Hành Gia" : "Astronaut Pioneer")}
                      </div>
                      <div className="flex items-center space-x-1 text-[7px] text-slate-400 mt-0.5 font-mono uppercase tracking-wider">
                        <span className={`w-1 h-1 rounded-full ${piUser ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`}></span>
                        <span>{piUser ? (language === "vi" ? "Ví Đã Khóa" : "Wallet Linked") : (language === "vi" ? "Chưa Kết Nối" : "Offline Wallet")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Auth Actions */}
                  {!piUser && typeof window !== "undefined" && (window as any).Pi ? (
                    <button
                      onClick={() => handlePiAuth(true)}
                      disabled={piPaymentStatus === "authenticating"}
                      className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-extrabold text-[8px] uppercase tracking-wider px-2 py-1 rounded-md cursor-pointer transition shadow-sm"
                    >
                      {piPaymentStatus === "authenticating" ? t("signingIn") : t("signIn")}
                    </button>
                  ) : !piUser && (
                    <span className="text-[7px] text-slate-400 font-mono border border-slate-200 bg-white px-1.5 py-0.5 rounded uppercase">
                      Local Mode
                    </span>
                  )}
                </div>

                {piPaymentError && !piUser && (
                  <div className="text-[8px] text-rose-500 font-mono leading-tight bg-rose-50 p-1.5 rounded border border-rose-100">
                    ⚠️ {t("errorPrefix")}{piPaymentError}
                  </div>
                )}

                {/* Currency Grid */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Gold Balance */}
                  <div className="bg-white border border-slate-200/80 rounded-lg p-1.5 flex items-center justify-between shadow-xs">
                    <div className="flex items-center space-x-1">
                      <span className="text-xs">💰</span>
                      <span className="text-[8px] font-bold text-slate-500 font-display uppercase tracking-wide">
                        {language === "vi" ? "Vàng" : "Gold"}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-extrabold text-amber-600">
                      {metaGold}¢
                    </span>
                  </div>

                  {/* Gift Boxes */}
                  <div className="bg-white border border-slate-200/80 rounded-lg p-1.5 flex items-center justify-between shadow-xs">
                    <div className="flex items-center space-x-1">
                      <span className="text-xs">🎁</span>
                      <span className="text-[8px] font-bold text-slate-500 font-display uppercase tracking-wide">
                        {language === "vi" ? "Hộp quà" : "Boxes"}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-extrabold text-rose-600 animate-pulse">
                      {giftBoxes}
                    </span>
                  </div>
                </div>

                {/* Sub-bar: API status & Mode Switcher */}
                <div className="border-t border-slate-200/60 pt-2 flex items-center justify-between text-[8px] font-mono uppercase tracking-wider text-slate-400">
                  <div className="flex items-center space-x-1">
                    <Shield className="w-3 h-3 text-slate-400" />
                    <span>API:</span>
                    <span className={piApiKeyConfigured === true ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>
                      {piApiKeyConfigured === true ? "ACTIVE" : "MISSING"}
                    </span>
                  </div>

                  {typeof window !== "undefined" && (window as any).Pi && (
                    <button
                      onClick={() => setPayWithPiMode(!payWithPiMode)}
                      className={`px-1.5 py-0.5 rounded text-[7px] font-mono uppercase tracking-wider font-extrabold transition-all duration-150 cursor-pointer ${
                        payWithPiMode
                          ? "bg-purple-600 text-white shadow-xs"
                          : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {payWithPiMode ? "PAY: PI" : "PAY: LOCAL"}
                    </button>
                  )}
                </div>
              </div>

              {/* Daily Check-in Button */}
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-200 rounded-xl p-2.5 flex items-center justify-between mb-3 shadow-sm">
                <div className="flex items-center space-x-2">
                  <div className="bg-amber-500 text-white p-1 rounded-lg animate-bounce">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-[11px] font-bold font-display uppercase tracking-wide text-amber-900 leading-tight">
                      {language === "vi" ? "Điểm Danh Hàng Ngày" : "Daily Check-in"}
                    </h4>
                    <p className="text-[9px] text-amber-700 font-sans leading-tight mt-0.5">
                      {language === "vi" ? "Xem quảng cáo nhận ngay +1,000 xu vàng!" : "Watch a short ad to receive +1,000 gold coins!"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDailyCheckIn}
                  disabled={hasCheckedInToday}
                  className={`px-3 py-1.5 font-display font-bold uppercase tracking-wider text-[9px] border-2 rounded-lg transition shadow-sm cursor-pointer min-w-[100px] text-center ${
                    hasCheckedInToday
                      ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                      : "bg-amber-500 hover:bg-amber-400 text-white border-amber-600 hover:border-amber-500 animate-pulse"
                  }`}
                >
                  {hasCheckedInToday 
                    ? (language === "vi" ? "Đã Điểm Danh" : "Checked In") 
                    : (language === "vi" ? "Nhận 1,000 Xu" : "Get 1,000¢")}
                </button>
              </div>

              {/* Tab Selector - Unified Modern Horizontal Layout */}
              <div className="flex overflow-x-auto scrollbar-none mb-3.5 p-1 bg-slate-100 rounded-xl border border-slate-200/80 space-x-1 shrink-0">
                {[
                  { id: "upgrades", label: t("systemsUpgrades"), icon: "🚀" },
                  { id: "inventory", label: language === "vi" ? "Túi Đồ" : "Inventory", icon: "🎒" },
                  { id: "marketplace", label: language === "vi" ? "Chợ" : "Bazaar", icon: "🎪" },
                  { id: "exchange", label: t("piExchange"), icon: "💱" },
                  { id: "history", label: t("transactionHistory"), icon: "📜" }
                ].map((tab) => {
                  const isActive = shopTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setShopTab(tab.id as any)}
                      className={`flex-1 min-w-[70px] py-1.5 px-0.5 text-center font-display font-bold uppercase tracking-wider text-[8px] rounded-lg transition-all duration-200 cursor-pointer flex flex-col items-center justify-center space-y-0.5 select-none ${
                        isActive
                          ? "bg-indigo-600 text-white shadow-sm font-extrabold scale-[1.02]"
                          : "bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200/50"
                      }`}
                    >
                      <span className="text-xs">{tab.icon}</span>
                      <span className="truncate max-w-[65px] leading-none text-[8px]">{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {shopTab === "upgrades" ? (
                /* Individual Shop Upgrade Slots */
                <div className="space-y-3 max-h-[160px] overflow-y-auto pr-1">
                  {[
                    { key: "damage", label: t("plasmaAccelerators"), icon: <Zap className="w-3.5 h-3.5" />, cost: (shopUpgrades.damage + 1) * 200000, desc: t("plasmaAcceleratorsDesc") },
                    { key: "health", label: t("nanoshieldArmor"), icon: <Heart className="w-3.5 h-3.5" />, cost: (shopUpgrades.health + 1) * 150000, desc: t("nanoshieldArmorDesc") },
                    { key: "speed", label: t("reactorThrusters"), icon: <Activity className="w-3.5 h-3.5" />, cost: (shopUpgrades.speed + 1) * 200000, desc: t("reactorThrustersDesc") },
                    { key: "magnet", label: t("quantumHarvester"), icon: <Sparkles className="w-3.5 h-3.5" />, cost: (shopUpgrades.magnet + 1) * 150000, desc: t("quantumHarvesterDesc") },
                    { key: "regen", label: t("naniteRepairSystems"), icon: <Heart className="w-3.5 h-3.5" />, cost: (shopUpgrades.regen + 1) * 250000, desc: t("naniteRepairSystemsDesc") },
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
                            <span>{t("maxed")}</span>
                          ) : payWithPiMode ? (
                            <>
                              <span className="text-[8px] opacity-85 uppercase leading-none">{t("piPayLabel")}</span>
                              <span className="font-bold mt-0.5">{(item.cost * 0.000001).toFixed(6).replace(/\.?0+$/, "")}π</span>
                            </>
                          ) : (
                            <>
                              <span className="text-[8px] opacity-80 uppercase leading-none">{t("upgradeLabel")}</span>
                              <span className="font-bold mt-0.5">{item.cost.toLocaleString()}¢</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : shopTab === "exchange" ? (
                /* Pi Exchange Panel */
                <div className="space-y-3.5 max-h-[190px] overflow-y-auto pr-1">
                  <div className="p-2 bg-purple-50 rounded-lg border border-purple-100 text-[9px] font-mono leading-normal text-purple-700">
                    <span className="font-extrabold text-purple-800 uppercase block mb-1">{t("decentralizedExchange")}</span>
                    {t("depositRate")}<br />
                    {t("withdrawRate")}<br />
                    {t("minWithdraw")}
                  </div>

                  {/* Buy options */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold font-display uppercase tracking-wider text-slate-500 block">
                      {t("depositTitle")}
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { coins: 10000, pi: 0.01 },
                        { coins: 50000, pi: 0.05 },
                        { coins: 100000, pi: 0.10 },
                        { coins: 500000, pi: 0.50 }
                      ].map((pkg) => (
                        <button
                          key={pkg.coins}
                          onClick={() => buyCoinsWithPi(pkg.coins, pkg.pi)}
                          className="p-1.5 border border-purple-200 hover:border-purple-500 bg-white hover:bg-purple-50/30 transition text-left rounded-lg cursor-pointer flex flex-col justify-between shadow-sm"
                        >
                          <span className="text-[10px] font-mono font-bold text-slate-800">+{pkg.coins.toLocaleString()} {language === "vi" ? "Xu" : "Coins"}</span>
                          <span className="text-[8px] font-bold font-mono text-purple-600 mt-0.5">{pkg.pi} π</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sell options */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold font-display uppercase tracking-wider text-slate-500 block">
                      {t("withdrawTitle")}
                    </span>
                    <div className="p-3 bg-slate-100 border-2 border-dashed border-slate-300 rounded-xl text-center space-y-1">
                      <span className="text-[11px] font-extrabold font-display uppercase text-slate-500 tracking-wider block">
                        🚧 Coming Soon 🚧
                      </span>
                      <p className="text-[9px] text-slate-400 font-sans leading-tight">
                        {language === "vi" 
                          ? "Tính năng rút Pi đang chờ phê duyệt quyền chính thức từ Pi Core Team." 
                          : "Withdrawal is awaiting official permissions from Pi Core Team."}
                      </p>
                    </div>
                  </div>
                </div>
              ) : shopTab === "history" ? (
                /* Transaction History Panel */
                <div className="space-y-2 max-h-[190px] overflow-y-auto pr-1">
                  {transactions.length === 0 ? (
                    <div className="p-4 text-center text-[10px] text-slate-400 font-mono">
                      {t("noTransactions")}
                    </div>
                  ) : (
                    <div className="space-y-1.5 font-mono text-[10px]">
                      {transactions.map((tx) => (
                        <div key={tx.id} className="p-2 bg-slate-50 border border-slate-200 rounded-lg flex flex-col space-y-1">
                          <div className="flex justify-between items-center">
                            <span className={`px-1 rounded text-[8px] font-bold uppercase ${
                              tx.type === "deposit"
                                ? "bg-purple-100 text-purple-700"
                                : tx.type === "withdrawal"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-blue-100 text-blue-700"
                            }`}>
                              {tx.type === "deposit"
                                ? t("txTypeDeposit")
                                : tx.type === "withdrawal"
                                ? t("txTypeWithdrawal")
                                : t("txTypeUpgrade")}
                            </span>
                            <span className="text-[8px] text-slate-400">
                              {new Date(tx.timestamp).toLocaleString(language === "vi" ? "vi-VN" : "en-US", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                day: "numeric",
                                month: "numeric",
                              })}
                            </span>
                          </div>
                          
                          <div className="flex justify-between items-center text-[9px]">
                            <span className="text-slate-600 font-sans leading-snug">{tx.memo || ""}</span>
                            <span className="font-extrabold flex items-center space-x-1">
                              <span className={tx.type === "withdrawal" ? "text-rose-500" : "text-emerald-500"}>
                                {tx.type === "withdrawal" ? "-" : "+"}{tx.amountCoins}¢
                              </span>
                              <span className="text-slate-300">|</span>
                              <span className="text-purple-600">
                                {tx.piAmount}π
                              </span>
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[8px] border-t border-dashed border-slate-200 pt-1 mt-0.5">
                            <span className="text-slate-400 font-mono truncate max-w-[140px]" title={tx.txid || tx.id}>
                              ID: {tx.txid ? tx.txid.slice(0, 10) + "..." : tx.id.slice(0, 10) + "..."}
                            </span>
                            <span className={`font-bold uppercase ${
                              tx.simulated
                                ? "text-amber-500 font-extrabold"
                                : tx.status === "success"
                                ? "text-emerald-600"
                                : tx.status === "pending"
                                ? "text-amber-500 animate-pulse"
                                : tx.status === "cancelled"
                                ? "text-slate-400"
                                : "text-rose-500"
                            }`}>
                              {tx.simulated
                                ? (language === "vi" ? "MÔ PHỎNG" : "SIMULATED")
                                : tx.status === "success"
                                ? t("txStatusSuccess")
                                : tx.status === "pending"
                                ? t("txStatusPending")
                                : tx.status === "cancelled"
                                ? t("txStatusCancelled")
                                : t("txStatusFailed")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : shopTab === "inventory" ? (
                /* Inventory and Unboxing Tab */
                <div className="space-y-3.5 max-h-[190px] overflow-y-auto pr-1">
                  {/* Gift Box Unboxing HUD Section */}
                  <div className="p-3 bg-rose-50 rounded-lg border border-rose-200 text-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="text-xl">🎁</span>
                        <div>
                          <span className="text-[11px] font-extrabold font-display uppercase tracking-wide text-rose-800 block">
                            {language === "vi" ? "Hộp Quà Thám Hiểm" : "Explorer Gift Boxes"}
                          </span>
                          <span className="text-[9px] text-rose-600 block leading-tight font-sans">
                            {language === "vi" ? "Chứa xu vàng và trang bị thuộc tính ngẫu nhiên!" : "Contains coins and randomly attributed equipment!"}
                          </span>
                        </div>
                      </div>
                      <div className="bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded text-xs font-mono font-bold text-rose-600 animate-pulse">
                        {giftBoxes} hộp
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleOpenGiftBox}
                      disabled={giftBoxes <= 0 || isOpeningBox}
                      className={`w-full py-2 border-2 rounded-lg font-display font-extrabold text-xs uppercase tracking-wider text-center transition cursor-pointer flex items-center justify-center space-x-1.5 ${
                        giftBoxes > 0
                          ? "bg-rose-500 hover:bg-rose-400 text-white border-rose-600 hover:border-rose-500 animate-bounce"
                          : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                      }`}
                    >
                      {isOpeningBox ? (
                        <span>✨ {language === "vi" ? "ĐANG MỞ..." : "OPENING..."} ✨</span>
                      ) : (
                        <>
                          <span>🔓</span>
                          <span>{language === "vi" ? "MỞ HỘP QUÀ" : "OPEN GIFT BOX"}</span>
                        </>
                      )}
                    </button>

                    {openedReward && (
                      <div className="bg-white border border-rose-200 p-2 rounded text-center text-[10px] font-mono text-emerald-600 font-extrabold animate-pulse">
                        🎉 {language === "vi" 
                          ? `Nhận được +${openedReward.coins} xu vàng${openedReward.item ? ` & [${openedReward.item.name}]!` : "!"}`
                          : `Received +${openedReward.coins} coins${openedReward.item ? ` & [${openedReward.item.name}]!` : "!"}`}
                      </div>
                    )}
                  </div>

                  {/* Active Equipment Slots */}
                  <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="text-[9px] font-bold font-display uppercase tracking-wider text-slate-500 block">
                      🛡️ {language === "vi" ? "Trang bị đang mặc" : "Equipped Gear"}
                    </span>
                    <div className="grid grid-cols-3 gap-1.5 text-center text-[9px] font-mono">
                      <div className="bg-white border border-slate-200 p-1 rounded">
                        <div className="text-slate-400 text-[8px] uppercase">{language === "vi" ? "Vũ khí" : "Weapon"}</div>
                        <div className="font-bold text-brand-accent mt-0.5 truncate text-[9px]">
                          {equippedWeapon ? equippedWeapon.name : "—"}
                        </div>
                        <div className="text-[8px] text-slate-500 mt-0.5">
                          {equippedWeapon ? `+${equippedWeapon.value}% Sát thương` : ""}
                        </div>
                        {equippedWeapon && (
                          <button
                            onClick={() => handleUnequipItem("weapon")}
                            className="text-[8px] text-rose-500 hover:underline cursor-pointer font-bold mt-1 block w-full uppercase"
                          >
                            {language === "vi" ? "Tháo" : "Unequip"}
                          </button>
                        )}
                      </div>
                      <div className="bg-white border border-slate-200 p-1 rounded">
                        <div className="text-slate-400 text-[8px] uppercase">{language === "vi" ? "Áo giáp" : "Armor"}</div>
                        <div className="font-bold text-brand-accent mt-0.5 truncate text-[9px]">
                          {equippedArmor ? equippedArmor.name : "—"}
                        </div>
                        <div className="text-[8px] text-slate-500 mt-0.5">
                          {equippedArmor ? (equippedArmor.statType === "health" ? `+${equippedArmor.value} HP` : `+${equippedArmor.value} HP/s`) : ""}
                        </div>
                        {equippedArmor && (
                          <button
                            onClick={() => handleUnequipItem("armor")}
                            className="text-[8px] text-rose-500 hover:underline cursor-pointer font-bold mt-1 block w-full uppercase"
                          >
                            {language === "vi" ? "Tháo" : "Unequip"}
                          </button>
                        )}
                      </div>
                      <div className="bg-white border border-slate-200 p-1 rounded">
                        <div className="text-slate-400 text-[8px] uppercase">{language === "vi" ? "Trang sức" : "Accessory"}</div>
                        <div className="font-bold text-brand-accent mt-0.5 truncate text-[9px]">
                          {equippedAccessory ? equippedAccessory.name : "—"}
                        </div>
                        <div className="text-[8px] text-slate-500 mt-0.5">
                          {equippedAccessory ? (equippedAccessory.statType === "speed" ? `+${equippedAccessory.value}% Tốc độ` : `+${equippedAccessory.value} Nam châm`) : ""}
                        </div>
                        {equippedAccessory && (
                          <button
                            onClick={() => handleUnequipItem("accessory")}
                            className="text-[8px] text-rose-500 hover:underline cursor-pointer font-bold mt-1 block w-full uppercase"
                          >
                            {language === "vi" ? "Tháo" : "Unequip"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Player Inventory List */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold font-display uppercase tracking-wider text-slate-500 block">
                      🎒 {language === "vi" ? "Hành lý cá nhân" : "Item Inventory"} ({inventory.length})
                    </span>
                    {inventory.length === 0 ? (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center text-[10px] text-slate-400 font-mono">
                        {language === "vi" ? "Rỗng. Hãy săn quái nhặt hộp quà để kiếm trang bị!" : "Empty. Hunt enemies and unbox gift boxes to find items!"}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {inventory.map((item) => {
                          let rarityColor = "border-slate-300 text-slate-600 bg-slate-50";
                          if (item.rarity === "rare") rarityColor = "border-emerald-300 text-emerald-600 bg-emerald-50/40";
                          if (item.rarity === "epic") rarityColor = "border-blue-300 text-blue-600 bg-blue-50/40";
                          if (item.rarity === "legendary") rarityColor = "border-amber-300 text-amber-600 bg-amber-50/40 animate-pulse";

                          let statDesc = "";
                          if (item.statType === "damage") statDesc = `+${item.value}% Sát thương`;
                          if (item.statType === "health") statDesc = `+${item.value} HP cực đại`;
                          if (item.statType === "regen") statDesc = `+${item.value} HP hồi/giây`;
                          if (item.statType === "speed") statDesc = `+${item.value}% Tốc độ di chuyển`;
                          if (item.statType === "magnet") statDesc = `+${item.value} Tầm nam châm`;

                          return (
                            <div key={item.id} className={`flex items-center justify-between p-2 rounded-lg border ${rarityColor}`}>
                              <div className="min-w-0 pr-2">
                                <span className="text-[10px] font-bold block uppercase truncate">{item.name}</span>
                                <span className="text-[8px] font-mono block text-slate-500 leading-tight mt-0.5">
                                  {item.rarity.toUpperCase()} • {statDesc}
                                </span>
                              </div>
                              <div className="flex items-center space-x-1 shrink-0">
                                {itemBeingListedId === item.id ? (
                                  <div className="flex items-center space-x-1 shrink-0 bg-purple-50 p-1 rounded border border-purple-200">
                                    <input
                                      type="number"
                                      min="1"
                                      value={customPriceInput}
                                      onChange={(e) => setCustomPriceInput(e.target.value)}
                                      className="w-12 px-1 py-0.5 text-[9px] border border-purple-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500 bg-white font-mono text-center text-slate-800"
                                      placeholder="Giá..."
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => {
                                        const parsedPrice = parseInt(customPriceInput, 10);
                                        if (isNaN(parsedPrice) || parsedPrice <= 0) {
                                          alert(language === "vi" ? "Vui lòng nhập giá bán lớn hơn 0!" : "Please enter a price greater than 0!");
                                          return;
                                        }
                                        handlePostListing(item, parsedPrice);
                                        setItemBeingListedId(null);
                                        setCustomPriceInput("");
                                      }}
                                      className="px-1.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-[8px] uppercase transition cursor-pointer"
                                    >
                                      {language === "vi" ? "Đăng" : "Post"}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setItemBeingListedId(null);
                                        setCustomPriceInput("");
                                        playSfx("hurt");
                                      }}
                                      className="px-1 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded text-[8px] uppercase transition cursor-pointer"
                                    >
                                      ❌
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleEquipItem(item)}
                                      className="px-1.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded text-[8px] uppercase transition cursor-pointer"
                                    >
                                      {language === "vi" ? "Mặc" : "Equip"}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setItemBeingListedId(item.id);
                                        setCustomPriceInput(String(Math.floor(item.sellPrice * 1.5)));
                                        playSfx("xp");
                                      }}
                                      className="px-1.5 py-1 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded text-[8px] uppercase transition cursor-pointer"
                                    >
                                      {language === "vi" ? "Bán chợ" : "List Bazaar"}
                                    </button>
                                    <button
                                      onClick={() => handleBuybackItem(item)}
                                      className="px-1.5 py-1 bg-amber-500 hover:bg-amber-450 border border-amber-600 text-amber-950 font-bold rounded text-[8px] uppercase transition cursor-pointer shadow-sm"
                                      title={language === "vi" ? `Bán lại cho hệ thống lấy ${getBuybackPrice(item.rarity)} xu` : `Sell back to system for ${getBuybackPrice(item.rarity)} coins`}
                                    >
                                      💰 {getBuybackPrice(item.rarity)}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : shopTab === "marketplace" ? (
                /* Marketplace Tab */
                <div className="space-y-3.5 max-h-[190px] overflow-y-auto pr-1">
                  {/* General Marketplace HUD */}
                  <div className="p-2 bg-indigo-50 rounded-lg border border-indigo-200 text-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold font-display uppercase tracking-wide text-indigo-800">
                        🛒 Chợ Giao Thương Pioneer Bazaar
                      </span>
                      <button
                        onClick={handleRefreshMarketplace}
                        disabled={isRefreshingMarketplace}
                        className={`px-2 py-0.5 rounded text-[8px] font-bold font-mono transition flex items-center space-x-1 uppercase cursor-pointer shrink-0 ${
                          isRefreshingMarketplace
                            ? "bg-indigo-200 text-indigo-500 cursor-not-allowed"
                            : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
                        }`}
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isRefreshingMarketplace ? "animate-spin" : ""}`} />
                        <span>{isRefreshingMarketplace ? (language === "vi" ? "Đang tải..." : "Loading...") : (language === "vi" ? "Làm mới" : "Refresh")}</span>
                      </button>
                    </div>
                    <p className="text-[9px] text-indigo-600 font-sans leading-tight">
                      {language === "vi"
                        ? "Đăng bán các trang bị của bạn lấy xu vàng hoặc mua các vũ khí huyền thoại từ người chơi khác!"
                        : "Post your items for gold or buy legendary gear listed by other players!"}
                    </p>
                  </div>

                  {/* Player's Active Marketplace Listings */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold font-display uppercase tracking-wider text-slate-500 block font-mono">
                      💼 Gian hàng của bạn ({marketplaceListings.filter(l => l.seller === "player").length})
                    </span>
                    {marketplaceListings.filter(l => l.seller === "player").length === 0 ? (
                      <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-center text-[9px] text-slate-400 font-mono">
                        {language === "vi" ? "Bạn chưa đăng bán món đồ nào." : "You have no active listings."}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {marketplaceListings.filter(l => l.seller === "player").map((listing) => (
                          <div key={listing.id} className="flex items-center justify-between p-2 bg-white rounded-lg border border-purple-200 shadow-sm">
                            <div className="min-w-0 pr-2">
                              <span className="text-[10px] font-bold text-slate-800 block truncate">{listing.item.name}</span>
                              <span className="text-[8px] font-mono text-purple-600 block mt-0.5">
                                {language === "vi" ? `Giá bán: ${listing.price} xu` : `Listed for: ${listing.price} coins`}
                              </span>
                            </div>
                            <div className="shrink-0 flex items-center space-x-1">
                              {listing.status === "sold" ? (
                                <button
                                  onClick={() => handleClaimSoldListing(listing.id, listing.price)}
                                  className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-white font-extrabold rounded text-[8px] uppercase transition cursor-pointer animate-pulse"
                                >
                                  {language === "vi" ? "NHẬN XU" : "CLAIM COINS"}
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleCancelListing(listing)}
                                  className="px-2 py-1 bg-slate-400 hover:bg-slate-300 text-white font-bold rounded text-[8px] uppercase transition cursor-pointer"
                                >
                                  {language === "vi" ? "Hủy" : "Cancel"}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Items for Sale by Other Players */}
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold font-display uppercase tracking-wider text-slate-500 block font-mono">
                      🛍️ Gian hàng công cộng ({marketplaceListings.filter(l => l.seller !== "player" && l.status === "listed").length})
                    </span>

                    {/* Rarity Filter Buttons */}
                    <div className="flex items-center space-x-1 overflow-x-auto py-1 scrollbar-none">
                      {[
                        { id: "all", labelVi: "Tất cả", labelEn: "All" },
                        { id: "common", labelVi: "Thường", labelEn: "Common" },
                        { id: "rare", labelVi: "Hiếm", labelEn: "Rare" },
                        { id: "epic", labelVi: "Sử thi", labelEn: "Epic" },
                        { id: "legendary", labelVi: "Huyền thoại", labelEn: "Legendary" }
                      ].map((f) => {
                        const isActive = selectedRarityFilter === f.id;
                        const label = language === "vi" ? f.labelVi : f.labelEn;
                        
                        let activeColor = "bg-indigo-600 border-indigo-600 text-white shadow-sm";
                        if (f.id === "common" && isActive) activeColor = "bg-slate-600 border-slate-600 text-white shadow-sm";
                        if (f.id === "rare" && isActive) activeColor = "bg-emerald-600 border-emerald-600 text-white shadow-sm";
                        if (f.id === "epic" && isActive) activeColor = "bg-blue-600 border-blue-600 text-white shadow-sm";
                        if (f.id === "legendary" && isActive) activeColor = "bg-amber-500 border-amber-500 text-white shadow-sm animate-pulse";

                        return (
                          <button
                            key={f.id}
                            onClick={() => {
                              setSelectedRarityFilter(f.id);
                              playSfx("xp");
                            }}
                            className={`px-2 py-0.5 rounded-full text-[8px] font-bold font-mono transition border cursor-pointer shrink-0 ${
                              isActive
                                ? activeColor
                                : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {marketplaceListings.filter(l => l.seller !== "player" && l.status === "listed").length === 0 ? (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center text-[10px] text-slate-400 font-mono">
                        {language === "vi" ? "Chợ hiện đang trống. Hãy quay lại sau!" : "Market is currently quiet. Check back later!"}
                      </div>
                    ) : (
                      (() => {
                        const filtered = marketplaceListings.filter(
                          l => l.seller !== "player" && l.status === "listed" && (selectedRarityFilter === "all" || l.item.rarity === selectedRarityFilter)
                        );
                        
                        if (filtered.length === 0) {
                          return (
                            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center text-[9px] text-slate-400 font-mono">
                              {language === "vi" ? "Không có trang bị nào thuộc phẩm chất này." : "No gear of this rarity found."}
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-1.5">
                            {filtered.map((listing) => {
                              let rarityColor = "border-slate-300 bg-slate-50 text-slate-700";
                              if (listing.item.rarity === "rare") rarityColor = "border-emerald-300 bg-emerald-50/30 text-emerald-800";
                              if (listing.item.rarity === "epic") rarityColor = "border-blue-300 bg-blue-50/30 text-blue-800";
                              if (listing.item.rarity === "legendary") rarityColor = "border-amber-300 bg-amber-50/30 text-amber-800 animate-pulse";

                              let statDesc = "";
                              if (listing.item.statType === "damage") statDesc = language === "vi" ? `+${listing.item.value}% Sát thương` : `+${listing.item.value}% Damage`;
                              if (listing.item.statType === "health") statDesc = `+${listing.item.value} HP`;
                              if (listing.item.statType === "regen") statDesc = language === "vi" ? `+${listing.item.value} HP hồi/s` : `+${listing.item.value} HP regen/s`;
                              if (listing.item.statType === "speed") statDesc = language === "vi" ? `+${listing.item.value}% Tốc độ` : `+${listing.item.value}% Speed`;
                              if (listing.item.statType === "magnet") statDesc = language === "vi" ? `+${listing.item.value} Tầm nhặt` : `+${listing.item.value} Magnet range`;

                              const canBuy = metaGold >= listing.price;

                              return (
                                <div key={listing.id} className={`flex items-center justify-between p-2 rounded-lg border ${rarityColor}`}>
                                  <div className="min-w-0 pr-2">
                                    <span className="text-[10px] font-bold block truncate uppercase">{listing.item.name}</span>
                                    <span className="text-[8px] font-mono block text-slate-500 leading-tight mt-0.5">
                                      {listing.item.rarity.toUpperCase()} • {statDesc} • {language === "vi" ? `Bán bởi: ${listing.seller}` : `Sold by: ${listing.seller}`}
                                    </span>
                                  </div>
                                  <button
                                    disabled={!canBuy}
                                    onClick={() => handleBuyListing(listing)}
                                    className={`px-2.5 py-1.5 font-bold rounded text-[8px] uppercase transition cursor-pointer shrink-0 flex items-center space-x-0.5 ${
                                      canBuy
                                        ? "bg-purple-600 hover:bg-purple-500 text-white font-extrabold"
                                        : "bg-slate-200 text-slate-400 cursor-not-allowed"
                                    }`}
                                  >
                                    <span>💰</span>
                                    <span>{listing.price}xu</span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* High Scores list */}
            {highScores.length > 0 && (
              <div className="bg-brand-card border border-brand-border rounded-xl p-3.5">
                <div className="flex items-center space-x-2 text-brand-muted text-[10px] font-bold uppercase tracking-wider mb-2 font-mono">
                  <Trophy className="w-4 h-4 text-brand-accent" />
                  <span>{t("missionLogRecords")}</span>
                </div>
                <div className="space-y-1.5 font-mono">
                  {highScores.map((score, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-lg border-2 border-brand-border text-xs">
                      <div className="flex items-center space-x-2">
                        <span className="text-brand-accent">0{idx + 1}.</span>
                        <span className="text-slate-700">{score.time}</span>
                      </div>
                      <div className="flex items-center space-x-3.5">
                        <span className="text-rose-400 font-bold">{score.kills} {t("killsLabel")}</span>
                        <span className="text-indigo-400 font-bold">{t("levelLabel")}.{score.level}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* System Clear Button & Policies Footer */}
            <div className="flex flex-col items-center space-y-2 mt-2 mb-1 border-t border-slate-100 pt-2.5">
              <button
                onClick={resetSaveData}
                className="text-[9px] text-brand-muted hover:text-rose-500 font-mono cursor-pointer transition underline uppercase tracking-wider"
              >
                {t("clearSaveData")}
              </button>
              
              <div className="flex items-center space-x-2 text-[8px] text-slate-400 font-mono uppercase">
                <button
                  onClick={() => setShowPrivacyPolicy(true)}
                  className="hover:text-purple-600 transition underline cursor-pointer"
                >
                  {t("privacyPolicyTitle")}
                </button>
                <span>•</span>
                <button
                  onClick={() => setShowTermsOfService(true)}
                  className="hover:text-purple-600 transition underline cursor-pointer"
                >
                  {t("termsOfServiceTitle")}
                </button>
              </div>
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
                {t("tutorialTitle")}
              </h3>
              <div className="space-y-3 text-xs text-slate-600">
                <div className="flex items-start space-x-3">
                  <div className="w-5 h-5 bg-brand-card border border-brand-border rounded flex items-center justify-center shrink-0 font-mono text-[9px] text-brand-accent font-bold">
                    {t("navTitle")}
                  </div>
                  <p className="font-sans leading-tight">
                    {language === "vi" ? (
                      <>Trượt cần điều khiển ở nửa dưới màn hình hoặc dùng phím <span className="text-brand-accent font-mono font-bold">WASD/Mũi tên</span> trên máy tính.</>
                    ) : language === "zh" ? (
                      <>在屏幕下半部分滑动摇杆，或在电脑上使用 <span className="text-brand-accent font-mono font-bold">WASD/方向键</span> 移动。</>
                    ) : language === "es" ? (
                      <>Deslice el joystick en la mitad inferior de la pantalla, o use <span className="text-brand-accent font-mono font-bold">WASD/Flechas</span> en la PC.</>
                    ) : language === "ko" ? (
                      <>화면 아래 절반에서 조이스틱을 슬라이드하거나 데스크톱에서 <span className="text-brand-accent font-mono font-bold">WASD/방향키</span>를 사용하십시오.</>
                    ) : language === "ja" ? (
                      <>画面の下半分でジョイスティックをスライドするか、デスクトップで <span className="text-brand-accent font-mono font-bold">WASD/方向キー</span> を使用します。</>
                    ) : (
                      <>Slide joystick on the bottom half of the screen, or use <span className="text-brand-accent font-mono font-bold">WASD/Arrows</span> on desktop.</>
                    )}
                  </p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-5 h-5 bg-brand-card border border-brand-border rounded flex items-center justify-center shrink-0 font-mono text-[9px] text-brand-accent font-bold">
                    {t("wepTitle")}
                  </div>
                  <p className="font-sans leading-tight">
                    {language === "vi" ? (
                      <>Vũ khí <span className="text-brand-accent font-bold">tự động bắn mục tiêu</span> gần nhất. Bạn chỉ cần tập trung di chuyển né tránh.</>
                    ) : language === "zh" ? (
                      <>武器会<span className="text-brand-accent font-bold">自动瞄准</span>最近的敌人进行射击。您只需专注于躲避移动即可。</>
                    ) : language === "es" ? (
                      <>Las armas <span className="text-brand-accent font-bold">disparan automáticamente</span> apuntando al invasor más cercano. Enfóquese estrictamente en la navegación.</>
                    ) : language === "ko" ? (
                      <>무기는 가장 가까운 적을 겨냥해 <span className="text-brand-accent font-bold">자동으로 발사</span>됩니다. 온전히 회피 및 이동에 집중하십시오.</>
                    ) : language === "ja" ? (
                      <>兵器は最も近い敵をターゲットに<span className="text-brand-accent font-bold">自動射撃</span>します。回避と移動のみに専念してください。</>
                    ) : (
                      <>Weapons <span className="text-brand-accent font-bold">autofire automatically</span> targeting the nearest invader. Focus strictly on navigation.</>
                    )}
                  </p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-5 h-5 bg-brand-card border border-brand-border rounded flex items-center justify-center shrink-0 font-mono text-[9px] text-brand-accent font-bold">
                    CORE
                  </div>
                  <p className="font-sans leading-tight">{t("coreDesc")}</p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-5 h-5 bg-brand-card border border-brand-border rounded flex items-center justify-center shrink-0 font-mono text-[9px] text-brand-accent font-bold">
                    META
                  </div>
                  <p className="font-sans leading-tight">{t("metaDesc")}</p>
                </div>
              </div>
              <button
                onClick={() => setShowTutorial(false)}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg cursor-pointer text-xs transition font-display uppercase tracking-wider"
              >
                {t("acknowledgeProtocols")}
              </button>
            </div>
          </div>
        )}

        {/* ==========================================
            PRIVACY POLICY MODAL
            ========================================== */}
        {showPrivacyPolicy && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
            <div className="bg-brand-card border-2 border-brand-border rounded-xl p-5 w-full max-w-[380px] space-y-4 geo-shadow flex flex-col">
              <div className="flex items-center space-x-2 text-brand-accent border-b border-brand-border pb-2">
                <Lock className="w-5 h-5" />
                <h3 className="text-sm font-bold tracking-tight text-slate-800 font-display uppercase">
                  {t("privacyPolicyTitle")}
                </h3>
              </div>
              
              <div className="max-h-[240px] overflow-y-auto pr-1 text-[11px] leading-relaxed text-slate-600 font-sans space-y-3">
                {language === "vi" ? (
                  <>
                    <p className="font-semibold text-slate-700">1. Thu thập thông tin</p>
                    <p>Ứng dụng trò chơi của chúng tôi chỉ lưu trữ cục bộ trên thiết bị của bạn tiến trình chơi, điểm số kỷ lục và lịch sử giao dịch. Nếu bạn đăng nhập bằng Ví Pi, chúng tôi sử dụng mã nhận dạng duy nhất (UID) ẩn danh từ Pi Network để đồng bộ hóa tài khoản.</p>
                    
                    <p className="font-semibold text-slate-700">2. Sử dụng thông tin</p>
                    <p>Thông tin thu thập được sử dụng duy nhất cho mục đích vận hành trò chơi, xử lý các giao dịch Pi và cải thiện trải nghiệm người dùng. Chúng tôi cam kết không thu thập dữ liệu cá nhân nhạy cảm.</p>
                    
                    <p className="font-semibold text-slate-700">3. Bảo mật giao dịch</p>
                    <p>Mọi giao dịch thanh toán hoặc rút Pi đều được thực hiện bảo mật qua SDK Pi Network chính thức kết nối trực tiếp đến Blockchain Pi. Chúng tôi không bao giờ lưu trữ mật khẩu hoặc mã bảo mật cụm từ ví của bạn.</p>
                    
                    <p className="font-semibold text-slate-700">4. Chia sẻ bên thứ ba</p>
                    <p>Chúng tôi không bán, trao đổi hoặc chuyển giao dữ liệu của bạn cho bất kỳ bên thứ ba nào.</p>
                    
                    <p className="font-semibold text-slate-700">5. Quyền kiểm soát dữ liệu</p>
                    <p>Bạn có toàn quyền xóa mọi dữ liệu lưu trữ bằng cách bấm vào nút "Xóa dữ liệu" ở chân trang màn hình chính của trò chơi.</p>
                  </>
                ) : language === "zh" ? (
                  <>
                    <p className="font-semibold text-slate-700">1. 信息收集</p>
                    <p>我们的游戏应用仅在您的设备本地存储游戏进度、最高分和本地交易历史。如果您通过 Pi 钱包登录，我们将使用 Pi Network 的匿名唯一标识符（UID）来同步您的帐户。</p>
                    
                    <p className="font-semibold text-slate-700">2. 信息使用</p>
                    <p>收集的信息仅用于运行游戏、处理 Pi 交易和改善用户体验。我们承诺不收集敏感的个人数据。</p>
                    
                    <p className="font-semibold text-slate-700">3. 交易安全</p>
                    <p>所有 Pi 支付或提取交易均通过 Pi Network 官方 SDK 安全执行，直接连接到 Pi 区块链。我们绝不会存储您的钱包密码或私钥密语。</p>
                    
                    <p className="font-semibold text-slate-700">4. 第三方共享</p>
                    <p>我们不会向任何第三方出售、交易或转让您的任何数据。</p>
                    
                    <p className="font-semibold text-slate-700">5. 数据控制权</p>
                    <p>您拥有数据的完整控制权。您可以随时通过游戏主界面底部的“清除保存数据”按钮清除所有本地数据。</p>
                  </>
                ) : language === "es" ? (
                  <>
                    <p className="font-semibold text-slate-700">1. Recopilación de Datos</p>
                    <p>Nuestra aplicación de juego solo almacena localmente en su dispositivo su progreso, puntajes récord e historial de transacciones. Si inicia sesión con su Billetera Pi, utilizamos un identificador único (UID) anónimo de Pi Network para sincronizar su cuenta.</p>
                    
                    <p className="font-semibold text-slate-700">2. Uso de la Información</p>
                    <p>La información recopilada se utiliza únicamente para el funcionamiento del juego, el procesamiento de transacciones de Pi y la mejora de la experiencia del usuario. Nos comprometemos a no recopilar datos personales sensibles.</p>
                    
                    <p className="font-semibold text-slate-700">3. Seguridad de las Transacciones</p>
                    <p>Todas las transacciones de pago o retiro de Pi se realizan de forma segura a través del SDK oficial de Pi Network, conectado directamente a la Blockchain de Pi. Nunca almacenamos su contraseña o frase de recuperación de billetera.</p>
                    
                    <p className="font-semibold text-slate-700">4. Compartir con Terceros</p>
                    <p>No vendemos, intercambiamos ni transferimos sus datos a terceros.</p>
                    
                    <p className="font-semibold text-slate-700">5. Control de Datos</p>
                    <p>Tiene control total sobre sus datos. Puede eliminar todos los datos locales en cualquier momento utilizando el botón "Borrar datos guardados" en el pie de página de la pantalla de inicio.</p>
                  </>
                ) : language === "ko" ? (
                  <>
                    <p className="font-semibold text-slate-700">1. 정보 수집</p>
                    <p>본 게임 애플리케이션은 게임 진행 상태, 최고 기록, 트랜잭션 내역 등을 기기 로컬에만 저장합니다. Pi 지갑으로 로그인하는 경우, Pi Network의 익명 고유 식별자(UID)를 사용하여 계정을 동기화합니다.</p>
                    
                    <p className="font-semibold text-slate-700">2. 정보 사용</p>
                    <p>수집된 정보는 게임의 원활한 운영, Pi 트랜잭션 처리, 사용자 경험 향상을 위한 목적으로만 사용됩니다. 민감한 개인정보는 일체 수집하지 않습니다.</p>
                    
                    <p className="font-semibold text-slate-700">3. 거래 안전성</p>
                    <p>모든 Pi 결제 및 출금 거래는 Pi Network 공식 SDK를 통해 Pi 블록체인에 직접 연결되어 안전하게 처리됩니다. 당사는 귀하의 지갑 비밀번호나 복구 비밀구절을 수집하거나 저장하지 않습니다.</p>
                    
                    <p className="font-semibold text-slate-700">4. 제3자 제공</p>
                    <p>당사는 수집된 사용자 데이터를 제3자에게 판매, 거래 또는 양도하지 않습니다.</p>
                    
                    <p className="font-semibold text-slate-700">5. 데이터 제어권</p>
                    <p>사용자는 자신의 데이터에 대한 전체 권한을 가집니다. 메인 화면 하단의 "저장 데이터 초기화" 버튼을 클릭하여 언제든지 로컬 데이터를 일괄 삭제할 수 있습니다.</p>
                  </>
                ) : language === "ja" ? (
                  <>
                    <p className="font-semibold text-slate-700">1. 情報収集</p>
                    <p>当ゲームアプリは、ゲームの進行状況、ハイスコア、および取引履歴をお客様のデバイスのローカルストレージにのみ保存します。Pi ウォレットでログインする場合、Pi Network の匿名の一意の識別子（UID）を使用してアカウントを同期します。</p>
                    
                    <p className="font-semibold text-slate-700">2. 情報の使用目的</p>
                    <p>収集された情報は、ゲームの運営、Pi トランザクションの処理、およびユーザーエクスペリエンスの向上にのみ使用されます。機微な個人情報を収集することは一切ありません。</p>
                    
                    <p className="font-semibold text-slate-700">3. トランザクションの安全性</p>
                    <p>すべての Pi 決済および出金処理は、Pi Network の公式 SDK を介して Pi ブロックチェーンに直接接続され、安全に実行されます。お客様のウォレットパスワードやパスフレーズを保存することは決してありません。</p>
                    
                    <p className="font-semibold text-slate-700">4. 第三者への開示</p>
                    <p>当社は、お客様のデータを第三者に販売、取引、または譲渡することはありません。</p>
                    
                    <p className="font-semibold text-slate-700">5. データの制御権</p>
                    <p>お客様は自身のデータに対して完全な権利を有します。メイン画面下部にある「セーブデータを削除」ボタンをクリックすることで、いつでもすべてのローカルデータを削除できます。</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-slate-700">1. Data Collection</p>
                    <p>Our game application only stores your progress, high scores, and transaction records locally on your device (localStorage). If you log in with your Pi Wallet, we use an anonymous unique identifier (UID) from Pi Network to sync your account.</p>
                    
                    <p className="font-semibold text-slate-700">2. Use of Information</p>
                    <p>The collected information is used solely to operate the game, process Pi transactions, and improve user experience. We commit to never collecting sensitive personal data.</p>
                    
                    <p className="font-semibold text-slate-700">3. Transaction Security</p>
                    <p>All Pi Network payment or withdrawal transactions are executed securely through the official Pi Network SDK, which connects directly to the Pi Blockchain. We never store your wallet password or passphrase.</p>
                    
                    <p className="font-semibold text-slate-700">4. Third-Party Sharing</p>
                    <p>We do not sell, trade, or transfer your data to any third parties.</p>
                    
                    <p className="font-semibold text-slate-700">5. Data Control Rights</p>
                    <p>You have full control over your data. You can delete all local save data at any time by clicking the "Clear Save Data" button in the footer of the home screen.</p>
                  </>
                )}
              </div>
              
              <button
                onClick={() => setShowPrivacyPolicy(false)}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer text-xs transition font-display uppercase tracking-wider border border-brand-border"
              >
                {t("closeLink")}
              </button>
            </div>
          </div>
        )}

        {/* ==========================================
            TERMS OF SERVICE MODAL
            ========================================== */}
        {showTermsOfService && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
            <div className="bg-brand-card border-2 border-brand-border rounded-xl p-5 w-full max-w-[380px] space-y-4 geo-shadow flex flex-col">
              <div className="flex items-center space-x-2 text-brand-accent border-b border-brand-border pb-2">
                <FileText className="w-5 h-5" />
                <h3 className="text-sm font-bold tracking-tight text-slate-800 font-display uppercase">
                  {t("termsOfServiceTitle")}
                </h3>
              </div>
              
              <div className="max-h-[240px] overflow-y-auto pr-1 text-[11px] leading-relaxed text-slate-600 font-sans space-y-3">
                {language === "vi" ? (
                  <>
                    <p className="font-semibold text-slate-700">1. Chấp thuận điều khoản</p>
                    <p>Bằng việc truy cập hoặc chơi trò chơi này, bạn đồng ý tuân thủ các Điều khoản dịch vụ này cùng với tất cả các luật pháp hiện hành.</p>
                    
                    <p className="font-semibold text-slate-700">2. Giao dịch Pi Network</p>
                    <p>Mọi giao dịch nạp hoặc rút đồng Pi (π) trong game đều tuân theo các nguyên tắc của Nhà phát triển Pi Network. Xu (¢) trong trò chơi là tiền ảo tiện ích và chỉ có giá trị sử dụng nội bộ để nâng cấp chỉ số hoặc các tính năng của trò chơi này, không có giá trị tiền tệ thực tế bên ngoài.</p>
                    
                    <p className="font-semibold text-slate-700">3. Sử dụng hợp lý & Công bằng</p>
                    <p>Người chơi không được phép can thiệp, sửa đổi mã nguồn, sử dụng phần mềm bên thứ ba (hack, cheat, bot) hoặc tận dụng bất kỳ lỗ hổng bảo mật nào để đạt lợi thế không công bằng trong game. Mọi hành vi vi phạm có thể dẫn đến việc khóa tài khoản hoặc hủy lịch sử giao dịch.</p>
                    
                    <p className="font-semibold text-slate-700">4. Giới hạn trách nhiệm</p>
                    <p>Trò chơi được cung cấp theo nguyên tắc "nguyên bản". Chúng tôi không chịu trách nhiệm cho các tổn thất dữ liệu do lỗi mạng Pi Network, sự cố thiết bị hoặc xóa bộ nhớ cache trình duyệt của người dùng.</p>
                    
                    <p className="font-semibold text-slate-700">5. Thay đổi điều khoản</p>
                    <p>Chúng tôi có quyền cập nhật các điều khoản dịch vụ này bất cứ lúc nào để phù hợp với quy định mới của nền tảng Pi Network.</p>
                  </>
                ) : language === "zh" ? (
                  <>
                    <p className="font-semibold text-slate-700">1. 接受条款</p>
                    <p>访问或游玩本游戏，即表示您同意遵守本服务条款及所有适用法律。</p>
                    
                    <p className="font-semibold text-slate-700">2. Pi Network 交易</p>
                    <p>游戏内的所有 Pi (π) 充值或提取交易均遵守 Pi Network 开发者指南。游戏内金币（¢）为虚拟道具，仅限本游戏内升级使用，在游戏外不具有任何实际货币价值。</p>
                    
                    <p className="font-semibold text-slate-700">3. 公平竞争</p>
                    <p>玩家不得篡改游戏代码、使用第三方软件（外挂、作弊、辅助工具）或利用任何漏洞以获取不正当优势。任何违规行为可能导致帐户被冻结或交易历史被取消。</p>
                    
                    <p className="font-semibold text-slate-700">4. 免责声明</p>
                    <p>本游戏按“现状”提供。我们对因 Pi Network 网络延迟、设备硬件问题或用户清理浏览器缓存导致的数据丢失不承担任何责任。</p>
                    
                    <p className="font-semibold text-slate-700">5. 条款修改</p>
                    <p>我们保留随时更新本服务条款的权利，以符合 Pi Network 平台的最新政策要求。</p>
                  </>
                ) : language === "es" ? (
                  <>
                    <p className="font-semibold text-slate-700">1. Aceptación de Términos</p>
                    <p>Al acceder o jugar a este juego, usted acepta cumplir con estos Términos de Servicio y con todas las leyes aplicables.</p>
                    
                    <p className="font-semibold text-slate-700">2. Transacciones de Pi Network</p>
                    <p>Cualquier transacción de depósito o retiro de Pi (π) dentro del juego sigue estrictamente las pautas de desarrollo de Pi Network. Las monedas virtuales (¢) son consumibles internos y solo sirven para mejoras de estadísticas dentro del juego, sin valor monetario real en el exterior.</p>
                    
                    <p className="font-semibold text-slate-700">3. Juego Limpio</p>
                    <p>No se permite a los usuarios piratear, modificar el código del juego, usar herramientas de terceros (hackeos, trampas, bots) o explotar errores del sistema para obtener ventajas injustas. Cualquier violación resultará en la suspensión del acceso.</p>
                    
                    <p className="font-semibold text-slate-700">4. Limitación de Responsabilidad</p>
                    <p>El juego se proporciona "tal cual". No nos hacemos responsables de pérdidas de datos resultantes de problemas de red en Pi Network, fallos del dispositivo o borrado del caché de navegación del usuario.</p>
                    
                    <p className="font-semibold text-slate-700">5. Modificación de Términos</p>
                    <p>Nos reservamos el derecho de actualizar estos términos en cualquier momento para mantener la conformidad con las pautas de Pi Network.</p>
                  </>
                ) : language === "ko" ? (
                  <>
                    <p className="font-semibold text-slate-700">1. 약관 동의</p>
                    <p>본 게임을 이용하거나 접속함으로써 귀하는 본 이용약관 및 모든 관련 법령을 준수하는 데 동의하게 됩니다.</p>
                    
                    <p className="font-semibold text-slate-700">2. Pi Network 거래 규칙</p>
                    <p>게임 내 모든 Pi (π) 입금 및 출금 거래는 Pi Network 개발자 가이드라인을 엄격히 준수합니다. 게임 내 가상 코인(¢)은 전적으로 내부 아이템 강화용 유틸리티이며, 게임 외부에서는 실제 금전적 가치가 전혀 없습니다.</p>
                    
                    <p className="font-semibold text-slate-700">3. 공정한 게임 이용</p>
                    <p>플레이어는 게임 코드를 변조하거나 제3자 비인가 프로그램(핵, 치트, 매크로 등)을 사용할 수 없으며, 불공정한 이득을 취하기 위해 시스템 취약점을 악용해서는 안 됩니다. 위반 시 계정 이용 제한 및 거래 내역 무효화 처리가 될 수 있습니다.</p>
                    
                    <p className="font-semibold text-slate-700">4. 면책 사항</p>
                    <p>본 서비스는 "있는 그대로" 제공됩니다. Pi Network 자체 네트워크 장애, 사용자 기기 이상 또는 브라우저 캐시 삭제로 인한 데이터 손실에 대해 당사는 일체 책임을 지지 않습니다.</p>
                    
                    <p className="font-semibold text-slate-700">5. 약관의 변경</p>
                    <p>당사는 Pi Network 플랫폼의 가이드라인 변경에 맞추어 본 약관을 언제든지 변경할 수 있는 권리를 보유합니다.</p>
                  </>
                ) : language === "ja" ? (
                  <>
                    <p className="font-semibold text-slate-700">1. 規約への同意</p>
                    <p>本ゲームにアクセス、またはプレイすることにより、お客様は本利用規約および関連するすべての法令を遵守することに同意したものとみなされます。</p>
                    
                    <p className="font-semibold text-slate-700">2. Pi Network 取引ルール</p>
                    <p>ゲーム内でのすべての Pi (π) 入出金取引は、Pi Network デベロッパーガイドラインに準拠します。ゲーム内の仮想コイン（¢）はゲーム内専用のユーティリティであり、外部において実際の金銭的価値は一切有しません。</p>
                    
                    <p className="font-semibold text-slate-700">3. 公平なプレイの維持</p>
                    <p>ゲームコードの改ざん、非公式なサードパーティ製ツール（チート、自動マクロなど）の利用、または不当な利益を得るためのバグの悪用は固く禁止されています。違反が確認された場合、アカウントの利用停止などの措置をとることがあります。</p>
                    
                    <p className="font-semibold text-slate-700">4. 免責事項</p>
                    <p>当ゲームは「現状有姿」で提供されます。Pi Network 自体の通信障害、デバイスの不具合、またはユーザーによるブラウザキャッシュの削除に伴うデータ損失について、当社は一切の責任を負いません。</p>
                    
                    <p className="font-semibold text-slate-700">5. 利用規約の改定</p>
                    <p>当社は、Pi Network プラットフォームのポリシー変更に合致させるため、本規約をいつでも改定する権利を有します。</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-slate-700">1. Acceptance of Terms</p>
                    <p>By accessing or playing this game, you agree to comply with these Terms of Service and all applicable laws.</p>
                    
                    <p className="font-semibold text-slate-700">2. Pi Network Transactions</p>
                    <p>All in-game Pi Network deposit or withdrawal transactions adhere strictly to the Pi Network developer guidelines. Virtual coins (¢) are purely in-game utility currencies used for stat upgrades and have no real-world monetary value outside this game.</p>
                    
                    <p className="font-semibold text-slate-700">3. Fair Play</p>
                    <p>Users are strictly prohibited from hacking, modifying the game code, using third-party tools (cheats, bots, automation), or exploiting system vulnerabilities to gain unfair advantages. Violators are subject to suspension.</p>
                    
                    <p className="font-semibold text-slate-700">4. Limitation of Liability</p>
                    <p>The game is provided on an "as-is" basis. We are not liable for any data loss resulting from Pi Network outages, user device issues, or browser cache clearing.</p>
                    
                    <p className="font-semibold text-slate-700">5. Modifications</p>
                    <p>We reserve the right to update these terms at any time to align with updated Pi Network platform developer requirements.</p>
                  </>
                )}
              </div>
              
              <button
                onClick={() => setShowTermsOfService(false)}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer text-xs transition font-display uppercase tracking-wider border border-brand-border"
              >
                {t("closeLink")}
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
                  <span className="text-slate-400 text-[8px] font-mono uppercase">{t("levelLabel")}</span>
                  <span className="text-indigo-400 font-bold font-display text-xs">{gameStats.level}</span>
                </div>
                {/* Time box */}
                <div className="bg-slate-900/90 border border-slate-800 px-3 py-1 rounded-lg flex items-center justify-center space-x-1.5 text-center">
                  <span className="text-slate-400 text-[8px] font-mono uppercase">{t("timeLabel")}</span>
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

        {/* Floating AI Adaptive Director HUD Panel runs hidden in the background per user experience request */}

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
                {t("evolutionProtocolActive")}
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-800 font-display uppercase">
                {t("tacticalAdaptation")}
              </h2>
              <p className="text-xs text-brand-muted mt-1 font-sans">{t("chooseUpgradeToLoad")}</p>
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
                    <span className="text-xs font-bold text-slate-800 font-display block uppercase">
                      {opt.id === "weapon_projectile" ? t("optPlasmaCannon")
                       : opt.id === "weapon_laser" ? t("optTeslaBeam")
                       : opt.id === "stat_maxHp" ? t("optNanoShield")
                       : opt.id === "stat_armor" ? t("optTitaniumPlating")
                       : opt.id === "stat_speed" ? t("optOverdriveThrusters")
                       : opt.id === "stat_magnet" ? t("optQuantumAttractor")
                       : opt.name}
                    </span>
                    <span className="text-[10px] text-slate-600 block leading-tight font-sans">
                      {opt.id === "weapon_projectile" ? t("optPlasmaCannonDesc")
                       : opt.id === "weapon_laser" ? t("optTeslaBeamDesc")
                       : opt.id === "stat_maxHp" ? t("optNanoShieldDesc")
                       : opt.id === "stat_armor" ? t("optTitaniumPlatingDesc")
                       : opt.id === "stat_speed" ? t("optOverdriveThrustersDesc")
                       : opt.id === "stat_magnet" ? t("optQuantumAttractorDesc")
                       : opt.desc}
                    </span>
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
                <span className="font-mono uppercase tracking-wider text-[10px]">{t("rerollWatchAd")}</span>
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
                {t("telemetryInterrupted")}
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-rose-500 font-display uppercase">
                {t("missionOver")}
              </h1>
              <p className="text-[10px] text-brand-muted font-mono uppercase mt-0.5">{t("pioneerOffline")}</p>
            </div>

            {/* Run statistics */}
            <div className="bg-brand-card border border-brand-border rounded-xl p-5 space-y-4 max-w-[380px] mx-auto w-full geo-shadow">
              <h3 className="text-[11px] font-bold tracking-wider text-brand-accent border-b border-brand-border pb-1.5 uppercase font-mono flex items-center justify-between">
                <span>{t("logExtractReport")}</span>
                <span className="text-brand-muted font-normal text-[9px]">ID: 409-SWARM</span>
              </h3>
              <div className="space-y-3 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-brand-muted">{t("missionDuration")}</span>
                  <span className="text-slate-800 font-bold">{finalStats.time}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-brand-muted">{t("invadersDefeated")}</span>
                  <span className="text-rose-400 font-bold">{finalStats.kills} {t("killsLabel")}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-brand-muted">{t("evolutionLevel")}</span>
                  <span className="text-indigo-400 font-bold">{t("levelLabel")} {finalStats.level}</span>
                </div>
                <div className="flex justify-between items-center border-t border-brand-border pt-3 font-sans font-bold">
                  <span className="text-brand-accent flex items-center space-x-1.5 uppercase text-[10px] tracking-wider font-display">
                    <Coins className="w-3.5 h-3.5" />
                    <span>{t("creditsRetrieved")}</span>
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
                  <span className="font-display uppercase tracking-wider text-xs">{t("reviveWatchAd")}</span>
                </button>
              )}

              {!doubleGoldApplied && (
                <button
                  onClick={handleDoubleGoldAd}
                  className="w-full py-2.5 bg-brand-card hover:bg-slate-50 border border-brand-accent/20 hover:border-brand-accent/40 text-brand-accent font-bold rounded-lg text-xs flex items-center justify-center space-x-2 transition cursor-pointer"
                >
                  <Coins className="w-4 h-4" />
                  <span className="font-mono uppercase tracking-wider text-[10px]">{t("doubleGoldWatchAd")}</span>
                </button>
              )}

              <button
                onClick={() => setGameState("START")}
                className="w-full py-3 bg-brand-card hover:bg-slate-50 border border-brand-border hover:border-brand-muted/40 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center space-x-1 transition cursor-pointer"
              >
                <span className="font-display uppercase tracking-widest">{t("returnToBase")}</span>
                <ArrowRight className="w-4 h-4 ml-1 text-brand-accent" />
              </button>
            </div>

            <div className="text-center text-[9px] text-brand-muted font-mono pb-2">
              {t("engineStatusPreserved")}
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
