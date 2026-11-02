const $ = id => document.getElementById(id);

const STARS_PER_TON = 125;
const SILVER_PER_TON = 125;
const LOCAL_IMAGE_NAMES = new Set(['Mask', "Durov's Figurine"]);
const FREE_CASE_KEY = 'freeCaseUsage';
const FREE_CASE_LIMIT = 10;
const MIN_STARS_ITEM_PRICE = 101;
const CASE_IMG_PATH = '/images/cases/';
const CDN = 'https://cdn.changes.tg/gifts/models';

/* ═══════════════ HALLOWEEN EVENT ═══════════════ */
const EVENT_START = new Date('2026-10-30T00:00:00');
const EVENT_END = new Date('2026-11-14T23:59:59');

const CATEGORIES = [
    { key: 'free', label: 'FREE CASES' },
    { key: 'starter', label: 'STARTER CASES' },
    { key: 'marvel', label: 'MARVEL CASES' },
    { key: 'halloween', label: 'HALLOWEEN CASES' },
    { key: 'new', label: 'NEWEST CASES' },
    { key: 'special', label: 'SPECIAL CASES' },
    { key: 'silver', label: 'SILVER CASES' },
    { key: 'cars', label: 'CARS CASES' },
    { key: 'nft', label: 'NFT CASES' },
    { key: 'retro', label: 'RETRO CASES' },
    { key: 'luxury', label: 'LUXURY CASES' },
];

const CASES = [
    /* ═══════════════ FREE ═══════════════ */
    {
        id: 0, category: 'free', name: 'Trash',
        free: true, freeType: 'unlimited',
        currency: 'star', tier: '#7B8089',
        image: `${CASE_IMG_PATH}trash.png`,
        items: [
            { name: 'Jester Hat', price: 500, chance: 0.72, currency: 'star' },
            { name: 'Snoop Dogg', price: 425, chance: 1.44, currency: 'star' },
            { name: 'Lol Pop', price: 325, chance: 2.16, currency: 'star' },
            { name: 'Silver', price: 100, chance: 4.32, currency: 'silver' },
            { name: 'Silver', price: 100, chance: 4.32, currency: 'silver' },
            { name: 'Silver', price: 50, chance: 6.69, currency: 'silver' },
            { name: 'Silver', price: 50, chance: 6.69, currency: 'silver' },
            { name: 'Silver', price: 25, chance: 16.26, currency: 'silver' },
            { name: 'Silver', price: 15, chance: 57.4, currency: 'silver' },
        ]
    },
    {
        id: 10000, category: 'free', name: 'Daily',
        free: true, freeType: 'daily',
        currency: 'star', tier: '#E8548A',
        image: `${CASE_IMG_PATH}daily.png`,
        items: [
            { name: 'Mighty Arm', price: 83750, chance: 1.44 },
            { name: 'Flying Broom', price: 2300, chance: 27.36 },
            { name: 'Desk Calendar', price: 300, chance: 71.2 },
        ]
    },

    /* ═══════════════ STARTER (дыра 0–250) ═══════════════ */
    {
        id: 42, category: 'starter', badge: 'new', name: 'Starter',
        price: 50, currency: 'star', tier: '#4FBE8D',
        image: `${CASE_IMG_PATH}starcase.png`,
        targetRtp: 0.97,
        keepLowPrice: true,
        items: [
            { name: 'Heart', price: 15, chance: 30, currency: 'star' },
            { name: 'Rose', price: 25, chance: 20, currency: 'star' },
            { name: 'Gift', price: 25, chance: 15, currency: 'star' },
            { name: 'Cake', price: 50, chance: 15, currency: 'star' },
            { name: 'Boquet', price: 50, chance: 10, currency: 'star' },
            { name: 'Trophy', price: 100, chance: 5, currency: 'star' },
            { name: 'Diamond', price: 100, chance: 2.83, currency: 'star' },
            { name: 'Lol Pop', price: 325, chance: 1.6, currency: 'star' },
            { name: 'Love Potion', price: 2075, chance: 0.5, currency: 'star' },
            { name: 'Eternal Rose', price: 3325, chance: 0.07, currency: 'star' },
        ]
    },
    {
        id: 43, category: 'starter', badge: 'new', name: 'Lucky',
        price: 100, currency: 'star', tier: '#E8B84F',
        image: `${CASE_IMG_PATH}gold.png`,
        targetRtp: 0.97,
        keepLowPrice: true,
        items: [
            { name: 'Heart', price: 15, chance: 20, currency: 'star' },
            { name: 'Rose', price: 25, chance: 15, currency: 'star' },
            { name: 'Gift', price: 25, chance: 10, currency: 'star' },
            { name: 'Cake', price: 50, chance: 15, currency: 'star' },
            { name: 'Boquet', price: 50, chance: 10, currency: 'star' },
            { name: 'Trophy', price: 100, chance: 8, currency: 'star' },
            { name: 'Diamond', price: 100, chance: 5.2, currency: 'star' },
            { name: 'Lol Pop', price: 325, chance: 10, currency: 'star' },
            { name: 'Love Potion', price: 2075, chance: 1.6, currency: 'star' },
            { name: 'Eternal Rose', price: 3325, chance: 0.2, currency: 'star' },
        ]
    },
    {
        id: 44, category: 'starter', badge: 'new', name: 'Premium',
        price: 150, currency: 'star', tier: '#9B86F0',
        image: `${CASE_IMG_PATH}luxury.png`,
        targetRtp: 0.97,
        keepLowPrice: true,
        items: [
            { name: 'Heart', price: 15, chance: 15, currency: 'star' },
            { name: 'Rose', price: 25, chance: 10, currency: 'star' },
            { name: 'Gift', price: 25, chance: 8, currency: 'star' },
            { name: 'Cake', price: 50, chance: 15, currency: 'star' },
            { name: 'Boquet', price: 50, chance: 10, currency: 'star' },
            { name: 'Trophy', price: 100, chance: 10, currency: 'star' },
            { name: 'Diamond', price: 100, chance: 7, currency: 'star' },
            { name: 'Lol Pop', price: 325, chance: 18, currency: 'star' },
            { name: 'Love Potion', price: 2075, chance: 2.2, currency: 'star' },
            { name: 'Eternal Rose', price: 3325, chance: 0.52, currency: 'star' },
        ]
    },

    /* ═══════════════ HALLOWEEN ═══════════════ */
    {
        id: 39, category: 'halloween', badge: 'new', name: 'Pumpkin Patch',
        price: 35000, currency: 'star', tier: '#E2793D',
        image: `${CASE_IMG_PATH}pumpkinpatch.png`,
        targetRtp: 0.97,
        items: [
            { name: 'Plush Pepe (Pumpkin)', price: 15000000, chance: 0.00 },
            { name: 'Mad Pumpkin (Pump King)', price: 7500000, chance: 0.01 },
            { name: 'Scared Cat (Salem)', price: 750000, chance: 4.9 },
            { name: 'Witch Hat (Black Magic)', price: 1250000, chance: 0.09 },
            { name: 'Genie Lamp (Lost Souls)', price: 225000, chance: 25 },
            { name: 'Voodoo Doll (Pumpkin)', price: 85000, chance: 30 },
            { name: 'Evil Eye (Monster Mash)', price: 8000, chance: 10 },
            { name: 'Jack-in-the-Box (Haunted House)', price: 30000, chance: 10 },
            { name: 'Trapped Heart (Undead Beat)', price: 12000, chance: 10 },
            { name: 'Lol Pop (Pumpkin)', price: 3500, chance: 10 },
        ]
    },
    {
        id: 40, category: 'halloween', name: 'Witching Hour',
        price: 2500000, currency: 'star', tier: '#4FBE8D',
        image: `${CASE_IMG_PATH}witchinghour.png`,
        items: [
            { name: 'Witch Hat (Baba Yaga)', price: 12500000, chance: 0.09518782 },
            { name: 'Witch Hat (Necromancy)', price: 750000, chance: 0.62091467 },
            { name: 'Genie Lamp (Lost Souls)', price: 6722080, chance: 3.33157364 },
            { name: 'Magic Potion (Verdant Vial)', price: 3616960, chance: 6.66314727 },
            { name: 'Perfume Bottle (Venom Mist)', price: 2785120, chance: 26.17665000 },
            { name: 'Voodoo Doll (Dark Side)', price: 85000, chance: 13.79810376 },
            { name: 'Scared Cat (Obelisk)', price: 61125, chance: 20.69715564 },
            { name: 'Hex Pot (Moonlight)', price: 5500, chance: 28.61726720 },
        ]
    },
    {
        id: 41, category: 'halloween', name: 'Cursed Relics',
        price: 15000000, currency: 'star', tier: '#9B86F0',
        image: `${CASE_IMG_PATH}cursedrelics.png`,
        items: [
            { name: "Gem Signet (Spinny Boi)", price: 120000000, chance: 0.02630488 },
            { name: 'Witch Hat (Baba Yaga)', price: 12500000, chance: 0.13491379 },
            { name: 'Skull Flower (Ghost Rider)', price: 30000000, chance: 0.78914649 },
            { name: 'Plush Pepe (Gucci Leap)', price: 47545150, chance: 1.31524416 },
            { name: 'Mad Pumpkin (The Joker)', price: 3500000, chance: 2.24856309 },
            { name: 'Heart Locket (Reactor)', price: 43520640, chance: 13.15244156 },
            { name: 'Evil Eye (Monster Mash)', price: 700000, chance: 17.98850471 },
            { name: 'Voodoo Doll (Curse)', price: 200000, chance: 35.97700941 },
            { name: 'Trapped Heart (Undead Beat)', price: 12000, chance: 28.36787192 },
        ]
    },

    /* ═══════════════ NEW ═══════════════ */
    {
        id: 3, category: 'new', badge: 'new', name: 'Mirage Lamps',
        price: 1750000, currency: 'star', tier: '#E2793D',
        image: `${CASE_IMG_PATH}miragelamp.png`,
        items: [
            { name: 'Mirage Lamp (Crimson Shrine)', price: 850000000, chance: 0.00144 },
            { name: 'Mirage Lamp (Warm Pixel)', price: 185000000, chance: 0.00576 },
            { name: 'Mirage Lamp (Soft Glow)', price: 150000000, chance: 0.036 },
            { name: 'Mirage Lamp (Rising Sun)', price: 15000000, chance: 0.101 },
            { name: 'Mirage Lamp (Iron Hearth)', price: 1000000, chance: 4.04 },
            { name: 'Mirage Lamp (Ruby Moon)', price: 50000, chance: 15.13 },
            { name: 'Mirage Lamp (Crimson Dusk)', price: 5000, chance: 80.69 },
        ]
    },
    {
        id: 38, category: 'new', badge: 'new', name: 'Treasure Hunter',
        price: 5000, currency: 'silver', tier: '#E8B84F',
        image: `${CASE_IMG_PATH}treasurehunter.png`,
        items: [
            { name: 'Durov Figure (T-Rex)', price: 5641999, chance: 0.00432, currency: 'star', image: 'images/DurovFigureT-Rex.png' },
            { name: 'Durov Figure (Mummy)', price: 10000000, chance: 0.00576, currency: 'star', image: 'images/DurovFigureMummy.png' },
            { name: 'Durov Figure (Mamont)', price: 100000000, chance: 0.00432, currency: 'star', image: 'images/DurovFigureMamont.png' },
            { name: 'Stars', price: 100, chance: 99.99, currency: 'star' }
        ]
    },

    /* ═══════════════ FULL-ITEM: Precious Peach ═══════════════ */
    {
        id: 48, category: 'new', badge: 'new', name: 'Precious Peach',
        price: 5000000, currency: 'star', tier: '#E2793D',
        useStarStack: true,
        items: [
            { name: 'Precious Peach (Smelting)', price: 15000000, chance: 0.8 },
            { name: 'Precious Peach (Caramel Red)', price: 15000000, chance: 0.8 },
            { name: 'Precious Peach (Cherry Secret)', price: 15000000, chance: 0.8 },
            { name: 'Precious Peach (Shocking)', price: 15000000, chance: 0.8 },
            { name: 'Precious Peach (Spanked)', price: 15000000, chance: 0.8 },
            { name: 'Precious Peach (Bubbling Blue)', price: 10747200, chance: 2.5 },
            { name: 'Precious Peach (Xmas Lights)', price: 10747200, chance: 2.5 },
            { name: 'Precious Peach (Blizzard)', price: 10747200, chance: 2.5 },
            { name: 'Precious Peach (Saint Nickel)', price: 10747200, chance: 2.5 },
            { name: 'Precious Peach (Gleam Bite)', price: 10747200, chance: 2.5 },
            { name: 'Precious Peach (Spoiled)', price: 10747200, chance: 2.5 },
            { name: 'Precious Peach (Impeached)', price: 10747200, chance: 2.5 },
            { name: 'Precious Peach (Angelic)', price: 10747200, chance: 2.5 },
            { name: 'Precious Peach (Pink Cupid)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Jelly Bubble)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Premium)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Rich Green)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Ladybug)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Bumblebee)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Cherry Season)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Cutout)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Airy Bright)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Mushroom)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Morningstar)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Smooch)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Jelly Stars)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (999 Karat)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Yin Yang)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Glass Heart)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Crypto Orange)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Tonfruit)', price: 211725, chance: 2.5 },
            { name: 'Precious Peach (Lush Green)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Glossy Pink)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Moss Posh)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Dreamer)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Terra Firma)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Cozy Warmth)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Golden Shine)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Malachite)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Bismuth)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Peach Black)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Iridescent)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Neo-Chrome)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Berry Pit)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Juicy Orange)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Twilight)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Ripe Green)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Faded Silver)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Juicy Tones)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Clear Sky)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Soap Bubble)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Heirloom)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Iron Blush)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Elegance)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Cutie Pink)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Party-Ready)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Honey Gold)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Bright Amber)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Bright Coral)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Morning Haze)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Bronze)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Christmas)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Mardi Gras)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Sunset)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Purple Glow)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Cold Iron)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Pure Peach)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Polaris)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Ruby Slice)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Ruby Red)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Smooth Touch)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Stardust)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Fuzzy Lilac)', price: 150000, chance: 0.7 },
            { name: 'Precious Peach (Neptune)', price: 100000, chance: 0.3 },
            { name: 'Precious Peach (Rosegold)', price: 100000, chance: 0.3 },
            { name: 'Precious Peach (Soft Sunset)', price: 100000, chance: 0.3 },
            { name: 'Precious Peach (Ogre Green)', price: 100000, chance: 0.3 },
            { name: 'Precious Peach (Pyrite)', price: 100000, chance: 0.3 },
            { name: 'Precious Peach (Glossy Finish)', price: 100000, chance: 0.3 },
            { name: 'Precious Peach (Ripe Pink)', price: 100000, chance: 0.3 },
        ]
    },

    /* ═══════════════ FULL-ITEM: Plush Pepe ═══════════════ */
    {
        id: 49, category: 'new', badge: 'new', name: 'Plush Pepe',
        price: 8000000, currency: 'star', tier: '#4FBE8D',
        useStarStack: true,
        items: [
            { name: 'Plush Pepe (Bavaria)', price: 300000000, chance: 0.005 },
            { name: 'Plush Pepe (X-Ray)', price: 1000206225, chance: 0.05 },
            { name: 'Plush Pepe (Gucci Leap)', price: 237725750, chance: 0.2 },
            { name: 'Plush Pepe (Hothead)', price: 169292209, chance: 0.3 },
            { name: 'Plush Pepe (Kung Fu Pepe)', price: 57000000, chance: 0.4 },
            { name: 'Plush Pepe (Pumpkin)', price: 15000000, chance: 3.0 },
            { name: 'Plush Pepe (Toading...)', price: 11670005, chance: 4.0 },
            { name: 'Plush Pepe (Emerald Plush)', price: 6985225, chance: 6.0 },
            { name: 'Plush Pepe (Emo Boi)', price: 5036225, chance: 8.0 },
            { name: 'Plush Pepe (Aqua Plush)', price: 3625000, chance: 8.0 },
            { name: 'Plush Pepe (Leonardo)', price: 3065488, chance: 7.0 },
            { name: 'Plush Pepe (Raphael)', price: 2707450, chance: 7.0 },
            { name: 'Plush Pepe (Donatello)', price: 2387445, chance: 7.0 },
            { name: 'Plush Pepe (Midas Pepe)', price: 2017345, chance: 8.0 },
            { name: 'Plush Pepe (Ninja Mike)', price: 1765151, chance: 7.0 },
            { name: 'Plush Pepe (Amalgam)', price: 1625025, chance: 8.0 },
            { name: 'Plush Pepe (Cozy Galaxy)', price: 1485150, chance: 8.0 },
            { name: 'Plush Pepe (Hue Jester)', price: 1337250, chance: 8.0 },
            { name: 'Plush Pepe (Poison Dart)', price: 1205075, chance: 8.0 },
            { name: 'Plush Pepe', price: 828750, chance: 2.0 },
        ]
    },

    /* ═══════════════ FULL-ITEM: Durov's Cap ═══════════════ */
    {
        id: 50, category: 'new', badge: 'new', name: "Durov's Cap",
        price: 11000000, currency: 'star', tier: '#9B86F0',
        useStarStack: true,
        items: [
            { name: "Durov's Cap (Toxic Guy)", price: 22670240, chance: 5.0 },
            { name: "Durov's Cap (RGB Glitch)", price: 1075025, chance: 12.0 },
            { name: "Durov's Cap (Falcon)", price: 545725, chance: 12.0 },
            { name: "Durov's Cap (Tron)", price: 398025, chance: 12.0 },
            { name: "Durov's Cap (Sky High)", price: 374025, chance: 12.0 },
            { name: "Durov's Cap (Neon)", price: 348750, chance: 12.0 },
            { name: "Durov's Cap (Honey Bee)", price: 305750, chance: 12.0 },
            { name: "Durov's Cap (Sunrise)", price: 237050, chance: 11.5 },
            { name: "Durov's Cap (Fun Time)", price: 232775, chance: 11.5 },
        ]
    },

    /* ═══════════════ MARVEL ═══════════════ */
    {
        id: 52, category: 'marvel', badge: 'new', name: 'Marvel Heroes',
        image: `${CASE_IMG_PATH}marvelheroes.png`,
        price: 777777, currency: 'star', tier: '#E62429',
        items: [
            { name: 'Signet Ring (Tony Stark)', price: 27000000, chance: 0.15 },
            { name: 'Bunny Muffin (Spiderman)', price: 14500000, chance: 0.2 },
            { name: 'Bunny Muffin (Hulk)', price: 9000000, chance: 0.7 },
            { name: 'Bunny Muffin (Wolverine)', price: 6500000, chance: 1.0 },
            { name: 'Sky Stilettos (Spidergirl)', price: 4000000, chance: 1.4 },
            { name: 'Toy Bear (Deadpool)', price: 2600000, chance: 2.5 },
            { name: 'Mini Oscar (Catwoman)', price: 1500000, chance: 3.5 },
            { name: 'Fresh Socks (Black Panther)', price: 1000000, chance: 5.0 },
            { name: 'Bow Tie (Spider Sense)', price: 550000, chance: 8.0 },
            { name: 'Perfume Bottle (Venom Mist)', price: 290000, chance: 12.0 },
            { name: 'Swiss Watch (Bruce Wayne)', price: 115000, chance: 18.0 },
            { name: 'Input Key (Angel)', price: 26000, chance: 25.4 },
            { name: 'Toy Bear (Angel)', price: 2500, chance: 21.92 },
        ]
    },

    /* ═══════════════ FULL-ITEM: Durov Funny ═══════════════ */
    {
        id: 53, category: 'new', badge: 'new', name: 'Durov Funny',
        price: 150000, currency: 'star', tier: '#E8B84F',
        image: 'images/unique/durovfunny/caseimg.png',
        items: [
            { name: 'Durov Funny (Socks)', price: 67000, chance: 60, currency: 'star', image: 'images/unique/durovfunny/DurovSocks.png' },
            { name: 'Durov Funny (Victory Medal)', price: 95000, chance: 39, currency: 'star', image: 'images/unique/durovfunny/VictoryMedal(1st).png' },
            { name: 'Durov Funny (Poplavok)', price: 5000000, chance: 1, currency: 'star', image: 'images/unique/durovfunny/Poplavok.png' },
        ]
    },

    /* ═══════════════ MINIONS ═══════════════ */
    {
        id: 54, category: 'new', badge: 'new', name: 'Minions',
        price: 400000, currency: 'star', tier: '#E8B84F',
        image: '/images/unique/minions/caseimg.png',
        items: [
            { name: 'Whip Cupcake (Minion)',    price: 5000000, chance: 1,    currency: 'star', image: 'https://cdn.changes.tg/gifts/models/Whip%20Cupcake/png/Minion.png' },
            { name: 'Bow Tie (Despicable)',     price: 1280000, chance: 2.5,  currency: 'star', image: 'https://cdn.changes.tg/gifts/models/Bow%20Tie/png/Despicable.png' },
            { name: 'Sleigh Bell (Stuart)',     price: 300000,  chance: 15,   currency: 'star', image: 'https://cdn.changes.tg/gifts/models/Sleigh%20Bell/png/Stuart.png' },
            { name: 'Hanging Star (Minion)',    price: 200000,  chance: 81.5, currency: 'star', image: 'https://cdn.changes.tg/gifts/models/Hanging%20Star/png/Minion.png' },
        ]
    },

        /* ═══════════════ ILLUMINANT ═══════════════ */
    {
        id: 55, category: 'new', badge: 'new', name: 'Illuminant',
        price: 666666, currency: 'star', tier: '#E8B84F',
        image: '/images/unique/Illuminant/caseimg.png',
        items: [
            { name: 'Victory Medal (Illuminant)',  price: 15000000, chance: 0.5,  currency: 'star', image: '/images/unique/Illuminant/VictoryMedal(Illuminant).png' },
            { name: 'Record Player (Illuminant)',  price: 3500000,  chance: 4.5,  currency: 'star', image: '/images/unique/Illuminant/RecordPlayer(Illuminant).png' },
            { name: 'Blink Stinky (Rapter)',       price: 1200000,  chance: 15,   currency: 'star', image: '/images/unique/Illuminant/BlinkStinky(Rapter).png' },
            { name: 'Whip Cupcake (Aliens)',       price: 450000,   chance: 35,   currency: 'star', image: '/images/unique/Illuminant/WhipCupcake(Aliens).png' },
            { name: 'Happy Brownie (Pyramids)',    price: 350000,   chance: 45,   currency: 'star', image: '/images/unique/Illuminant/HappyBrownie(Pyramids).png' },
        ]
    },
    /* ═══════════════ SPECIAL ═══════════════ */
    {
        id: 4, category: 'special', name: 'Bloody Night',
        price: 500000, currency: 'star', tier: '#E8607A',
        image: `${CASE_IMG_PATH}bloodynight.png`,
        items: [
            { name: 'Plush Pepe (Hothead)', price: 169292209, chance: 0.014 },
            { name: 'Plush Pepe (Gucci Leap)', price: 47545150, chance: 0.014 },
            { name: 'Plush Pepe (Toading...)', price: 11670005, chance: 0.072 },
            { name: 'Plush Pepe (Midas Pepe)', price: 2017345, chance: 0.418 },
            { name: 'Plush Pepe (Cozy Galaxy)', price: 1485150, chance: 0.634 },
            { name: 'Plush Pepe (Emerald Plush)', price: 1397045, chance: 0.85 },
            { name: 'Plush Pepe (Emo Boi)', price: 1007245, chance: 1.05 },
            { name: 'Plush Pepe (Aqua Plush)', price: 725000, chance: 1.27 },
            { name: 'Plush Pepe (Amalgam)', price: 325005, chance: 19.46 },
            { name: 'Plush Pepe (Hue Jester)', price: 267450, chance: 35.68 },
            { name: 'Plush Pepe (Poison Dart)', price: 241015, chance: 40.54 },
        ]
    },
    {
        id: 5, category: 'special', name: 'Ninja Turtles',
        price: 1000000, currency: 'star', tier: '#4FBE8D',
        image: `${CASE_IMG_PATH}ninjaturtles.png`,
        items: [
            { name: 'Heart Locket (Turtles)', price: 347668296, chance: 0.014 },
            { name: 'Plush Pepe (Leonardo)', price: 3065488, chance: 0.979 },
            { name: 'Plush Pepe (Raphael)', price: 2707450, chance: 1.02 },
            { name: 'Plush Pepe (Donatello)', price: 2387445, chance: 1.15 },
            { name: 'Plush Pepe (Ninja Mike)', price: 1765151, chance: 1.15 },
            { name: 'Happy Brownie (Raphael)', price: 150650, chance: 41 },
            { name: 'Mighty Arm (Pizza Pump)', price: 174635, chance: 54.69 },
        ]
    },
    {
        id: 6, category: 'special', name: 'Monarch',
        price: 1300000, currency: 'star', tier: '#7B8089',
        image: `${CASE_IMG_PATH}monarch.png`,
        targetRtp: 0.97,
        items: [
            { name: 'Gem Signet (Spinny Boi)', price: 120000000, chance: 0.1001 },
            { name: 'Crystal Eagle', price: 74000000, chance: 0.5003 },
            { name: 'Plush Pepe (Kung Fu Pepe)', price: 57000000, chance: 1.0006 },
            { name: 'Toy Bear (Angel)', price: 650, chance: 19.5998 },
            { name: 'Input Key (Angel)', price: 105, chance: 78.8992 },
        ]
    },
    {
        id: 7, category: 'special', name: 'Radioactive',
        price: 3000000, currency: 'star', tier: '#4FBE8D',
        image: `${CASE_IMG_PATH}radioactive.png`,
        items: [
            { name: 'Heart Locket (Reactor)', price: 43520640, chance: 0.115 },
            { name: "Durov's Cap (Toxic Guy)", price: 22670240, chance: 0.202 },
            { name: 'Precious Peach (Gleam Bite)', price: 10747200, chance: 0.216 },
            { name: 'Genie Lamp (Lost Souls)', price: 6722080, chance: 0.547 },
            { name: 'Astral Shard (Uranium)', price: 2950000, chance: 1.08 },
            { name: 'Magic Potion (Verdant Vial)', price: 2750000, chance: 2.16 },
            { name: 'Perfume Bottle (Venom Mist)', price: 2785120, chance: 95.68 },
        ]
    },
    {
        id: 8, category: 'special', name: 'Angel',
        price: 3333333, currency: 'star', tier: '#E8B84F',
        image: `${CASE_IMG_PATH}angel.png`,
        targetRtp: 0.97,
        items: [
            { name: 'Loot Bag (Priestly)', price: 150000000, chance: 0.101 },
            { name: 'Sleigh Bell (Holy Grenade)', price: 90000000, chance: 0.502 },
            { name: 'Top Hat (Celestial)', price: 1777778, chance: 16.482378 },
            { name: 'Ionic Dryer (Angel Blast)', price: 1000000, chance: 25.249535 },
            { name: 'XMAS Stocking (Heaven)', price: 111111, chance: 57.765087 },
        ]
    },

    /* ═══════════════ CARS ═══════════════ */
    {
        id: 9, category: 'cars', name: 'M5 F90',
        price: 55555, currency: 'star', tier: '#7B8089',
        image: `${CASE_IMG_PATH}m5f90.png`,
        items: [
            { name: 'Heart Locket (Neptune)', price: 888750, chance: 0.253 },
            { name: "Durov's Cap (Neon)", price: 348750, chance: 1.61 },
            { name: 'Precious Peach (Yin Yang)', price: 162325, chance: 4.24 },
            { name: 'Cupid Charm (Pepe Love)', price: 87050, chance: 6 },
            { name: 'Artisan Brick (Bomb Planted)', price: 63025, chance: 13.3 },
            { name: 'Mighty Arm (Body Builder)', price: 40750, chance: 32.1 },
            { name: 'Astral Shard (Crystal Punk)', price: 31250, chance: 42.5 },
        ]
    },
    {
        id: 10, category: 'cars', name: 'G63',
        price: 177777, currency: 'star', tier: '#7B8089',
        image: `${CASE_IMG_PATH}g63.png`,
        items: [
            { name: 'Plush Pepe (Amalgam)', price: 1625025, chance: 0.658 },
            { name: 'Heart Locket (Delegam)', price: 986250, chance: 1.322 },
            { name: 'Heart Locket (Shield of Sun)', price: 623500, chance: 1.98 },
            { name: 'Heroic Helmet (Frozen Aegis)', price: 230325, chance: 5.931 },
            { name: 'Artisan Brick (Gold Block)', price: 157025, chance: 15.899 },
            { name: 'Loot Bag (Crypto Byte)', price: 113750, chance: 26.51 },
            { name: 'Ion Gem (Prismatic)', price: 56250, chance: 47.7 },
        ]
    },
    {
        id: 11, category: 'cars', name: 'Porsche 911',
        price: 599999, currency: 'star', tier: '#E8B84F',
        image: `${CASE_IMG_PATH}porsche911.png`,
        items: [
            { name: 'Plush Pepe (Gucci Leap)', price: 237725750, chance: 0.043 },
            { name: 'Heart Locket (Mecha Love)', price: 600000, chance: 4.27 },
            { name: "Durov's Cap (Tron)", price: 398025, chance: 95.69 },
        ]
    },
    {
        id: 12, category: 'cars', name: 'URUS',
        price: 1666666, currency: 'star', tier: '#9B86F0',
        image: `${CASE_IMG_PATH}urus.png`,
        items: [
            { name: 'Plush Pepe (X-Ray)', price: 1000206225, chance: 0.072 },
            { name: 'Heart', price: 15, chance: 25 },
            { name: 'Plush Pepe (Hue Jester)', price: 1337250, chance: 74.93 },
        ]
    },
    {
        id: 13, category: 'cars', name: 'Cyber',
        price: 13444222, currency: 'star', tier: '#4FB8C4',
        image: `${CASE_IMG_PATH}cyber.png`,
        targetRtp: 0.97,
        items: [
            { name: 'Plush Pepe (Bavaria)', price: 300000000, chance: 0.10144 },
            { name: "Durov's Figurine (Ilon)", price: 150000000, chance: 0.30432 },
            { name: 'Pool Float (Nessie)', price: 74000000, chance: 0.330002 },
            { name: 'Happy Brownie (Toilet Bot)', price: 52228677, chance: 0.413005 },
            { name: 'Mood Pack (Bank Vault)', price: 3124789, chance: 3.50005 },
            { name: 'Toy Bear (Blueprint)', price: 1536235, chance: 95.351183 },
        ]
    },

    /* ═══════════════ NFT ═══════════════ */
    {
        id: 14, category: 'nft', name: 'Frozen Heart',
        price: 4500, currency: 'star', tier: '#4FB8C4',
        image: `${CASE_IMG_PATH}frozenheart.png`,
        items: [
            { name: 'Precious Peach (Bubbling Blue)', price: 202750, chance: 0.533 },
            { name: 'Astral Shard (Aquarium)', price: 28950, chance: 1.45 },
            { name: 'Kissed Frog (Ectofrog)', price: 10500, chance: 3.61 },
            { name: 'Mad Pumpkin (Frostbite)', price: 6025, chance: 8.97 },
            { name: 'Love Potion (Ice Queen)', price: 2550, chance: 15.28 },
            { name: 'Cupid Charm (Crystal Clear)', price: 3375, chance: 23.45 },
            { name: 'Eternal Candle (Bubble Bath)', price: 1775, chance: 46.71 },
        ]
    },
    {
        id: 15, category: 'nft', name: 'Bubble Gum',
        price: 12000, currency: 'star', tier: '#E8548A',
        image: `${CASE_IMG_PATH}bubblegum.png`,
        items: [
            { name: "Durov's Cap (Sky High)", price: 374025, chance: 0.252 },
            { name: 'Heroic Helmet (Punk Skull)', price: 261750, chance: 0.312 },
            { name: 'Gem Signet (8 Bit Diamond)', price: 105275, chance: 0.993 },
            { name: 'Loot Bag (City Life)', price: 74750, chance: 1.5 },
            { name: 'Astral Shard (Nectarite)', price: 37050, chance: 2.93 },
            { name: 'Bonded Ring (Rainbow)', price: 21075, chance: 4.94 },
            { name: 'Electric Skull (Half Alive)', price: 13750, chance: 7.8 },
            { name: 'Toy Bear (Fazbear)', price: 8350, chance: 17.07 },
            { name: 'Low Rider (Neon Nitro)', price: 6025, chance: 26.02 },
            { name: 'Fresh Socks (Billie Jean)', price: 4465, chance: 38.18 },
        ]
    },
    {
        id: 16, category: 'nft', name: 'Cats',
        price: 40000, currency: 'star', tier: '#E8548A',
        image: `${CASE_IMG_PATH}cats.png`,
        items: [
            { name: 'Plush Pepe (Poison Dart)', price: 1205075, chance: 0.092 },
            { name: 'Heart Locket (Fairy Dust)', price: 637025, chance: 0.382 },
            { name: "Durov's Cap (Fun Time)", price: 232775, chance: 0.856 },
            { name: 'Artisan Brick (Cash Roll)', price: 102050, chance: 1.8 },
            { name: 'Genie Lamp (Cat Spirit)', price: 82050, chance: 2.57 },
            { name: 'Nail Bracelet (Moon Cat)', price: 74725, chance: 4.65 },
            { name: 'Scared Cat (Obelisk)', price: 61125, chance: 7.06 },
            { name: 'Nail Bracelet (Cat Person)', price: 52500, chance: 11.08 },
            { name: 'Resistance Dog', price: 36250, chance: 12.28 },
            { name: 'Bonded Ring (Cat Bed)', price: 22725, chance: 23.34 },
            { name: 'Gem Signet (Old Bronze)', price: 18250, chance: 35.89 },
        ]
    },
    {
        id: 17, category: 'nft', name: 'Glitch',
        price: 135000, currency: 'star', tier: '#4FBE8D',
        image: `${CASE_IMG_PATH}glitch.png`,
        items: [
            { name: 'Heart Locket (Turtles)', price: 12330325, chance: 0.058 },
            { name: 'Plush Pepe (Emo Boi)', price: 5036225, chance: 0.173 },
            { name: 'Heart Locket (Nightclub)', price: 607050, chance: 1.17 },
            { name: "Durov's Cap (Shadow)", price: 225000, chance: 2.93 },
            { name: 'Precious Peach (Peach Black)', price: 110725, chance: 20.66 },
            { name: 'Loot Bag (Black Purrse)', price: 112050, chance: 20.66 },
            { name: 'Heroic Helmet (Praetorian)', price: 74025, chance: 23.34 },
            { name: 'Artisan Brick (Concrete)', price: 41250, chance: 31.01 },
        ]
    },
    {
        id: 18, category: 'nft', name: 'Dream',
        price: 250000, currency: 'star', tier: '#E8B84F',
        image: `${CASE_IMG_PATH}dream.png`,
        items: [
            { name: 'Plush Pepe (Aqua Plush)', price: 3625000, chance: 1.093 },
            { name: "Durov's Cap (RGB Glitch)", price: 1075025, chance: 2.176 },
            { name: 'Artisan Brick (USBrick)', price: 360500, chance: 5.137 },
            { name: "Durov's Cap (Sunrise)", price: 237050, chance: 10.856 },
            { name: 'Mighty Arm (Gladiator)', price: 133200, chance: 36.219 },
            { name: 'Toy Bear (Dark Knight)', price: 30325, chance: 44.519 },
        ]
    },

    /* ═══════════════ RETRO ═══════════════ */
    {
        id: 19, category: 'retro', name: 'Beggar',
        price: 220, currency: 'star', tier: '#9B86F0',
        image: `${CASE_IMG_PATH}beggar.png`,
        items: [
            { name: 'Love Potion', price: 2075, chance: 0.229 },
            { name: 'Evil Eye', price: 925, chance: 1.14 },
            { name: 'Witch Hat', price: 725, chance: 2.84 },
            { name: 'Holiday Drink', price: 450, chance: 5.68 },
            { name: 'Tama Gadget', price: 450, chance: 6.82 },
            { name: 'Lunar Snake', price: 350, chance: 8.44 },
            { name: 'Lol Pop', price: 325, chance: 8.99 },
            { name: 'Signet Ring', price: 100, chance: 30.85 },
            { name: 'Diamond Ring', price: 100, chance: 35.01 },
        ]
    },
    {
        id: 20, category: 'retro', name: 'Plodder',
        price: 444, currency: 'star', tier: '#4FB8C4',
        image: `${CASE_IMG_PATH}plodder.png`,
        items: [
            { name: 'Perfume Bottle', price: 17350, chance: 0.084 },
            { name: 'Kissed Frog', price: 8625, chance: 0.431 },
            { name: 'Eternal Rose', price: 3325, chance: 2.16 },
            { name: 'Hanging Star', price: 1225, chance: 2.84 },
            { name: 'Sakura Flower', price: 1075, chance: 4.22 },
            { name: 'Hex Pot', price: 700, chance: 4.92 },
            { name: 'Ginger Cookie', price: 450, chance: 5.6 },
            { name: 'Pet Snake', price: 450, chance: 5.6 },
            { name: 'Xmas Stocking', price: 350, chance: 14.05 },
            { name: 'Snake Box', price: 325, chance: 17.57 },
            { name: 'Signet Ring', price: 100, chance: 42.52 },
        ]
    },
    {
        id: 21, category: 'retro', name: 'Office Clerk',
        price: 689, currency: 'star', tier: '#E8B84F',
        image: `${CASE_IMG_PATH}officeclerk.png`,
        items: [
            { name: 'Mini Oscar', price: 30250, chance: 0.067 },
            { name: 'Loot Bag', price: 19375, chance: 0.067 },
            { name: 'Scared Cat', price: 10500, chance: 0.348 },
            { name: 'Voodoo Doll', price: 3725, chance: 2.57 },
            { name: 'Trapped Heart', price: 2075, chance: 3.2 },
            { name: 'Valentine Box', price: 1175, chance: 3.2 },
            { name: 'Jolly Chimp', price: 900, chance: 5.16 },
            { name: 'Light Sword', price: 725, chance: 6.28 },
            { name: 'Star Notepad', price: 600, chance: 14.08 },
            { name: 'Hypno Lollipop', price: 475, chance: 14.08 },
            { name: 'Lol Pop', price: 325, chance: 50.95 },
        ]
    },
    {
        id: 22, category: 'retro', name: 'Manager',
        price: 835, currency: 'star', tier: '#E8B84F',
        image: `${CASE_IMG_PATH}manager.png`,
        items: [
            { name: 'Bonded Ring (Pixel Loot)', price: 19250, chance: 0.219 },
            { name: 'Jester Hat (Pepe Hop)', price: 14825, chance: 0.436 },
            { name: 'Hanging Star (This Is Fine)', price: 8150, chance: 0.978 },
            { name: 'Easter Egg (Boiled Pepe)', price: 3025, chance: 1.63 },
            { name: 'Ginger Cookie (Headless)', price: 2350, chance: 2.62 },
            { name: 'Easter Egg (Creeper)', price: 1425, chance: 4.59 },
            { name: 'Jolly Chimp (Retro Cartoon)', price: 1150, chance: 5.91 },
            { name: 'Jack in the box (Aliens)', price: 675, chance: 22.31 },
            { name: 'Clover Pin (Corrupted)', price: 475, chance: 27.87 },
            { name: 'Snake Box', price: 325, chance: 33.44 },
        ]
    },
    {
        id: 23, category: 'retro', name: 'Oligarch',
        price: 926, currency: 'star', tier: '#E8B84F',
        image: `${CASE_IMG_PATH}oligarch.png`,
        items: [
            { name: 'Heroic Helmet', price: 48625, chance: 0.029 },
            { name: 'Gem Signet', price: 14775, chance: 0.187 },
            { name: 'Neko Helmet', price: 5750, chance: 0.907 },
            { name: 'Ionic Dryer', price: 3850, chance: 1.14 },
            { name: 'Mad Pumpkin', price: 3500, chance: 2.06 },
            { name: 'Evil Eye', price: 925, chance: 24.8 },
            { name: 'Jelly Bunny', price: 800, chance: 29.53 },
            { name: 'Lush Bouquet', price: 650, chance: 41.35 },
        ]
    },
    {
        id: 24, category: 'retro', name: 'Gold',
        price: 1999, currency: 'star', tier: '#E8B84F',
        image: `${CASE_IMG_PATH}gold.png`,
        targetRtp: 0.97,
        items: [
            { name: 'Artisan Brick (Gold Bar)', price: 76725, chance: 0.147 },
            { name: 'Magic Potion (Gold Medal)', price: 27025, chance: 0.295 },
            { name: 'Swiss Watch (Day Trader)', price: 15050, chance: 1.25 },
            { name: 'Low Rider (Gold Rush)', price: 11025, chance: 1.68 },
            { name: 'Toy Bear (Golden Cub)', price: 7850, chance: 2.05 },
            { name: 'Ionic Dryer (Gold Rush)', price: 7075, chance: 4.17 },
            { name: 'Love Candle (Golden Glow)', price: 2925, chance: 12.39 },
            { name: 'Bunny Muffin (Gold)', price: 900, chance: 35.57 },
            { name: 'Lol Pop (Gold Star)', price: 625, chance: 42.45 },
        ]
    },
    {
        id: 25, category: 'retro', name: 'Director',
        price: 926, currency: 'star', tier: '#4FBE8D',
        image: `${CASE_IMG_PATH}director.png`,
        items: [
            { name: 'Astral Shard', price: 21100, chance: 0.124 },
            { name: 'Bonded Ring', price: 12975, chance: 0.31 },
            { name: 'Toy Bear', price: 4250, chance: 1.76 },
            { name: 'Cupid Charm', price: 2875, chance: 2.95 },
            { name: 'Record Player', price: 2200, chance: 4.15 },
            { name: 'Berry Box', price: 875, chance: 18.29 },
            { name: 'Spy Agaric', price: 725, chance: 32.28 },
            { name: 'Party Sparkler', price: 500, chance: 40.14 },
        ]
    },
    {
        id: 26, category: 'retro', name: 'Dark',
        price: 4999, currency: 'star', tier: '#4FB8C4',
        image: `${CASE_IMG_PATH}dark.png`,
        items: [
            { name: 'Loot Bag (Black Purrse)', price: 112050, chance: 0.383 },
            { name: 'Heroic Helmet (Black Thorn)', price: 74075, chance: 0.513 },
            { name: 'Gem Signet (Black Lotus)', price: 34225, chance: 0.904 },
            { name: 'Toy Bear (Ursa Major)', price: 22625, chance: 1.6 },
            { name: 'Swiss Watch (Memory Flash)', price: 11775, chance: 3.15 },
            { name: 'Signet Ring (Obsidian)', price: 7975, chance: 5.43 },
            { name: 'Record Player (Dark Noir)', price: 5825, chance: 7.26 },
            { name: 'Mad Pumpkin (Daredevil)', price: 4600, chance: 9.23 },
            { name: 'Bow Tie (Dark Lord)', price: 3925, chance: 12.31 },
            { name: 'Hanging Star (Black Hole)', price: 3125, chance: 20.52 },
            { name: 'Evil Eye (8 Ball)', price: 1725, chance: 38.7 },
        ]
    },

    /* ═══════════════ LUXURY ═══════════════ */
    {
        id: 27, category: 'luxury', name: 'Palm',
        price: 13999, currency: 'star', tier: '#4FB8C4',
        image: `${CASE_IMG_PATH}palm.png`,
        items: [
            { name: 'Precious Peach (Rich Green)', price: 211725, chance: 0.294 },
            { name: "Astral Shard (Eve's Apple)", price: 117250, chance: 0.587 },
            { name: 'Sakura Flower (Flowey)', price: 83225, chance: 2.36 },
            { name: 'Bonded Ring (Duckling)', price: 31825, chance: 5.21 },
            { name: 'Gem Signet (Elven Shade)', price: 21750, chance: 9.97 },
            { name: 'Kissed Frog (Lava Leap)', price: 18975, chance: 11 },
            { name: 'Sakura Flower (Sunflower)', price: 12275, chance: 13.02 },
            { name: 'Love Potion (Banana)', price: 8225, chance: 16.01 },
            { name: 'Cupid Charm (Dryad Heart)', price: 5275, chance: 18.02 },
            { name: 'Crystal Ball (Dryad Circle)', price: 3125, chance: 23.53 },
        ]
    },
    {
        id: 28, category: 'luxury', name: 'Burj',
        price: 37999, currency: 'star', tier: '#E8B84F',
        image: `${CASE_IMG_PATH}burj.png`,
        items: [
            { name: 'Plush Pepe (Hue Jester)', price: 1337250, chance: 0.333 },
            { name: "Durov's Cap (Honey Bee)", price: 305750, chance: 0.659 },
            { name: 'Mighty Arm (Crystal Fist)', price: 132175, chance: 2.23 },
            { name: 'Loot Bag (Conductor)', price: 84225, chance: 4.54 },
            { name: 'Ion Gem (Prismatic)', price: 56250, chance: 5.62 },
            { name: 'Genie Lamp (Lava Lamp)', price: 42875, chance: 11.41 },
            { name: 'Astral Shard (Bogartite)', price: 29225, chance: 14.44 },
            { name: 'Diamond Ring (Black Hole)', price: 23250, chance: 24.08 },
            { name: 'Gem Signet (Amethyst)', price: 17225, chance: 36.69 },
        ]
    },
    {
        id: 29, category: 'luxury', name: 'Luxury',
        price: 119999, currency: 'star', tier: '#9B86F0',
        image: `${CASE_IMG_PATH}luxury.png`,
        items: [
            { name: 'Plush Pepe (Emerald Plush)', price: 6985225, chance: 0.166 },
            { name: 'Heart Locket (Cirque)', price: 1135075, chance: 0.333 },
            { name: "Durov's Cap (Falcon)", price: 545725, chance: 1.48 },
            { name: 'Precious Peach (Angelic)', price: 245050, chance: 4.54 },
            { name: 'Nail Bracelet (Interstellar)', price: 197425, chance: 7.56 },
            { name: 'Heroic Helmet (Cyberpunk)', price: 147250, chance: 10.66 },
            { name: 'Artisan Brick (Fight Club)', price: 112400, chance: 7.82 },
            { name: 'Mini Oscar (Fiery-Hot)', price: 87550, chance: 16.19 },
            { name: 'Electric Skull (Terminator)', price: 70225, chance: 22.48 },
            { name: 'Gem Signet (Death Star)', price: 49575, chance: 28.77 },
        ]
    },

    /* ═══════════════ SILVER ═══════════════ */
    {
        id: 30, category: 'silver', name: 'Zombie',
        price: 100000, currency: 'silver', tier: '#4FBE8D',
        image: `${CASE_IMG_PATH}zombie.png`,
        items: [
            { name: 'Electric Skull (Zombie)', price: 540000, chance: 30, currency: 'star' },
            { name: 'Evil Eye (Monster Mash)', price: 700000, chance: 25, currency: 'star' },
            { name: 'Jack-in-the-Box (Haunted House)', price: 1110000, chance: 20, currency: 'star' },
            { name: 'Sharp Tongue (Zombie Bite)', price: 1360000, chance: 12, currency: 'star' },
            { name: 'Mad Pumpkin (Red Demon)', price: 1650000, chance: 10, currency: 'star' },
            { name: 'Trapped Heart (Undead Beat)', price: 2000000, chance: 2, currency: 'star' },
            { name: 'Scared Cat (Zombie)', price: 5000000, chance: 0.7, currency: 'star' },
            { name: 'Voodoo Doll (Dark Side)', price: 12000000, chance: 0.2, currency: 'star' },
            { name: 'Skull Flower (Ghost Rider)', price: 30000000, chance: 0.1, currency: 'star' },
        ]
    },
    {
        id: 31, category: 'silver', name: 'Pinkie',
        price: 250000, currency: 'silver', tier: '#E8548A',
        image: `${CASE_IMG_PATH}pinkie.png`,
        items: [
            { name: 'Pretty Posy (Sakura)', price: 1750000, chance: 30, currency: 'star' },
            { name: 'Sky Stilettos (Glossy)', price: 2100000, chance: 25, currency: 'star' },
            { name: 'Sakura Flower (Sakura)', price: 2400000, chance: 20, currency: 'star' },
            { name: 'Heart Locket (Sakura)', price: 2650000, chance: 12, currency: 'star' },
            { name: 'Cupid Charm (Blossom)', price: 2795000, chance: 10, currency: 'star' },
            { name: 'Love Candle (Rose Garden)', price: 3200000, chance: 2, currency: 'star' },
            { name: 'Nail Bracelet (Pink Needle)', price: 15000000, chance: 0.7, currency: 'star' },
            { name: 'Love Potion (Fairy Pollen)', price: 25000000, chance: 0.2, currency: 'star' },
            { name: 'Lush Bouquet (Million Roses)', price: 80000000, chance: 0.1, currency: 'star' },
        ]
    },
    {
        id: 32, category: 'silver', name: 'Food',
        price: 15000, currency: 'silver', tier: '#E8B84F',
        image: `${CASE_IMG_PATH}food.png`,
        items: [
            { name: 'Homemade Cake (Birthday)', price: 80000, chance: 30, currency: 'star' },
            { name: 'Ginger Cookie (Santa Claus)', price: 115000, chance: 25, currency: 'star' },
            { name: 'Instant Ramen (Classic Ramen)', price: 140000, chance: 20, currency: 'star' },
            { name: 'Bunny Muffin (Chocolate)', price: 150000, chance: 12, currency: 'star' },
            { name: 'Whip Cupcake (Bitcoin)', price: 185000, chance: 10, currency: 'star' },
            { name: 'Mousse Cake (Cheesecake)', price: 220000, chance: 2, currency: 'star' },
            { name: 'Easter Egg (Chocolate)', price: 800000, chance: 0.7, currency: 'star' },
            { name: 'Lol Pop (Watermelon)', price: 3000000, chance: 0.2, currency: 'star' },
            { name: 'Swiss Watch (Day Trader)', price: 15000000, chance: 0.1, currency: 'star' },
        ]
    },
    {
        id: 33, category: 'silver', name: 'Gravity',
        price: 50000, currency: 'silver', tier: '#4FB8C4',
        image: `${CASE_IMG_PATH}gravity.png`,
        items: [
            { name: 'Stellar Rocket (To The Moon)', price: 210000, chance: 30, currency: 'star' },
            { name: 'Astral Shard (Galactite)', price: 320000, chance: 25, currency: 'star' },
            { name: 'Moon Pendant (Lunar Orbit)', price: 385000, chance: 20, currency: 'star' },
            { name: 'Snow Globe (Winter)', price: 450000, chance: 12, currency: 'star' },
            { name: 'Crystal Ball (Nebula)', price: 520000, chance: 10, currency: 'star' },
            { name: 'Lunar Snake (Lunar Year)', price: 700000, chance: 2, currency: 'star' },
            { name: 'Sleigh Bell (Stellar Map)', price: 3000000, chance: 0.7, currency: 'star' },
            { name: "Durov's Cap (Nightshade)", price: 15000000, chance: 0.2, currency: 'star' },
            { name: 'Big Year (Sputnik-1)', price: 50000000, chance: 0.1, currency: 'star' },
        ]
    },
    {
        id: 34, category: 'silver', name: 'Star Wars',
        price: 25000, currency: 'silver', tier: '#7B8089',
        image: `${CASE_IMG_PATH}starwars.png`,
        items: [
            { name: 'Light Sword (Jedi Luke)', price: 15000, chance: 5, currency: 'star' },
            { name: 'Astral Shard (Galactite)', price: 25000, chance: 33.92, currency: 'star' },
            { name: 'Stellar Rocket (Normandy)', price: 35000, chance: 27.14, currency: 'star' },
            { name: 'Electric Skull (Starman)', price: 50000, chance: 16.29, currency: 'star' },
            { name: 'Sleigh Bell (Darth Vader)', price: 52500, chance: 13.57, currency: 'star' },
            { name: "Durov's Cap (Shadow)", price: 300000, chance: 2.04, currency: 'star' },
            { name: 'Perfume Bottle (Ebony Rose)', price: 2000000, chance: 1.36, currency: 'star' },
            { name: 'Spy Agaric (Nighteye)', price: 16000000, chance: 0.543, currency: 'star' },
            { name: 'Pool Float (Nessie)', price: 74000000, chance: 0.136, currency: 'star' },
        ]
    },
    {
        id: 35, category: 'silver', name: 'Durov',
        price: 15000, currency: 'silver', tier: '#9B86F0',
        image: `${CASE_IMG_PATH}durov.png`,
        items: [
            { name: "Durov's Cap (Classic)", price: 45000, chance: 30, currency: 'star' },
            { name: "Durov's Glasses (Neo)", price: 75000, chance: 25, currency: 'star' },
            { name: 'Love Potion (Durov Duck)', price: 105000, chance: 20, currency: 'star' },
            { name: 'Desk Calendar (Durov Day)', price: 130000, chance: 12, currency: 'star' },
            { name: 'Swag Bag (Swag Droid)', price: 148000, chance: 10, currency: 'star' },
            { name: 'Big Year (Pavel Durov)', price: 200000, chance: 2, currency: 'star' },
            { name: 'Snoop Dogg (Doggfather)', price: 800000, chance: 0.7, currency: 'star' },
            { name: 'Plush Pepe (Midas Pepe)', price: 5000000, chance: 0.2, currency: 'star' },
            { name: 'Gem Signet (Molten Core)', price: 25000000, chance: 0.1, currency: 'star' },
        ]
    },
    {
        id: 36, category: 'silver', name: 'Redo',
        price: 1000000, currency: 'silver', tier: '#E2793D',
        image: `${CASE_IMG_PATH}redo.png`,
        items: [
            { name: 'Resistance Dog (Lightpaw)', price: 2500000, chance: 30, currency: 'star' },
            { name: 'Liberty Figure (Columbia)', price: 4500000, chance: 25, currency: 'star' },
            { name: "Durov's Glasses (Thug Life)", price: 6500000, chance: 20, currency: 'star' },
            { name: 'Loot Bag (Crypto Punk)', price: 8500000, chance: 12, currency: 'star' },
            { name: 'Swag Bag (Snoop Life)', price: 9950000, chance: 10, currency: 'star' },
            { name: 'Heart Locket (Turtles)', price: 15000000, chance: 2, currency: 'star' },
            { name: 'Plush Pepe (Hothead)', price: 100000000, chance: 0.7, currency: 'star' },
            { name: 'Gem Signet (Spinny Boi)', price: 120000000, chance: 0.2, currency: 'star' },
            { name: 'Resistance Dog (Loki)', price: 1000000000, chance: 0.1, currency: 'star' },
        ]
    },
    {
        id: 37, category: 'silver', name: 'Pepe',
        price: 5000000, currency: 'silver', tier: '#4FBE8D',
        image: `${CASE_IMG_PATH}pepe.png`,
        items: [
            { name: 'Plush Pepe (Midas Pepe)', price: 22500000, chance: 30, currency: 'star' },
            { name: 'Kissed Frog (Happy Pepe)', price: 32000000, chance: 25, currency: 'star' },
            { name: 'Spy Agaric (Pepe Mania)', price: 45500000, chance: 20, currency: 'star' },
            { name: 'Mood Pack (Pepe Unleashed)', price: 55000000, chance: 12, currency: 'star' },
            { name: 'Loot Bag (Pepe Bag)', price: 85000000, chance: 10, currency: 'star' },
            { name: 'Jester Hat (Pepe Hop)', price: 150000000, chance: 2, currency: 'star' },
            { name: 'Sharp Tongue (Pepelicious)', price: 450000000, chance: 0.7, currency: 'star' },
            { name: "Durov's Glasses (Pepe Dream)", price: 185000000, chance: 0.2, currency: 'star' },
            { name: 'Nail Bracelet (Pepe Band)', price: 485000000, chance: 0.1, currency: 'star' },
        ]
    },
];

/* ═══════════════ СОСТОЯНИЕ ═══════════════ */
let currentCase = null;
let selectedQty = 1;
let isOpening = false;
let currentWinItems = [];
let spinInterval = null;
let isDemo = false;
let eventTimerInterval = null;
let eventBannerClickTimeout = null;
let _winSellInProgress = false;
let apiProfileReady = false;

/* Балансы — локальный кэш; Telegram-профиль синхронизируется с PostgreSQL API. */
function getStars() { return parseInt(localStorage.getItem('userStars') || '0'); }
function getSilver() { return parseInt(localStorage.getItem('userSilver') || '0'); }
function updateBalance() {
    const el = $('balanceDisplay');
    if (el) el.textContent = window.formatStars(getStars());
    const sv = $('silverDisplay');
    if (sv) sv.textContent = window.formatStars(getSilver());
}

/* ═══════════════ INIT ═══════════════ */
document.addEventListener('DOMContentLoaded', init);

async function init() {
    window.TG.updateHeaderUI();
    window.refreshCurrencyUI();
    CASES.forEach(normalizeCaseItems);
    renderCases();
    updateBalance();
    restoreLastDrop();
    initLiveWinsFeed();

    if (window.TG?.isTelegram && window.LootStarAPI) {
        try {
            await window.LootStarAPI.loadProfile();
            apiProfileReady = true;
        } catch (error) {
            console.error('[cases] PostgreSQL profile load failed:', error);
            showToast('Не удалось загрузить игровой профиль с сервера', 'err');
        }
    }
    updateBalance();
    window.refreshCurrencyUI();

    window.addEventListener('profileDataLoaded', () => {
        updateBalance();
        window.refreshCurrencyUI();
    });

    document.addEventListener('click', e => {
        const el = e.target.closest('button, .case-card, .qty-btn, .modal-win-btn');
        if (el && !isOpening) window.vibrate('light');
    });

    setInterval(() => {
        if (isOpening) return;
        document.querySelectorAll('.case-card[data-free="1"]').forEach(card => renderFreeCaseCard(card));
    }, 60000);
}

/* ═══════════════ ВАЛЮТА / ИКОНКИ ═══════════════ */
function getCurrencyIcon(c) {
    if (c === 'silver') return window.SILVER_ICON || '/shared/silver-star.svg';
    return window.STAR_ICON || '/shared/star.png';
}
function getItemCurrency(gift, caseObj) {
    return gift.currency || caseObj?.currency || 'star';
}
function getStarIcon() { return window.STAR_ICON || '/shared/star.png'; }

/* ═══════════════ HALLOWEEN EVENT BANNER ═══════════════ */
function getEventTimeLeft() {
    const now = Date.now();
    const start = EVENT_START.getTime();
    const end = EVENT_END.getTime();
    const isForced = localStorage.getItem('force_halloween') === '1';

    if (now < start && !isForced) {
        return { mode: 'before', diff: start - now };
    }
    if (now < end || isForced) {
        const diff = isForced && now > end ? 24 * 3600000 : end - now;
        return { mode: 'active', diff: Math.max(0, diff) };
    }
    return null;
}

function formatEventTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    if (d > 0) return `${d}д ${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function renderEventBanner() {
    const t = getEventTimeLeft();
    if (!t) return '';
    const isBefore = t.mode === 'before';
    const label = isBefore ? 'До старта:' : 'До конца:';
    return `
    <div class="event-banner" id="eventBanner" onclick="handleEventBannerClick(event)">
        <div class="event-banner-shade"></div>
        <div class="event-banner-inner">
            <div class="event-banner-text">
                <div class="event-banner-kicker">Ограниченное время</div>
                <div class="event-banner-title">Halloween Event</div>
                <div class="event-banner-timer">
                    <span class="event-banner-timer-label">${label}</span>
                    <strong id="eventTimer">${formatEventTime(t.diff)}</strong>
                </div>
            </div>
            <div class="event-banner-orb" aria-hidden="true"></div>
        </div>
    </div>`;
}

function handleEventBannerClick(event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (eventBannerClickTimeout) clearTimeout(eventBannerClickTimeout);
    location.href = 'halloween/index.html';
}

function startEventTimer() {
    if (eventTimerInterval) clearInterval(eventTimerInterval);
    const tick = () => {
        const el = $('eventTimer');
        const banner = $('eventBanner');
        if (!el || !banner) {
            clearInterval(eventTimerInterval);
            eventTimerInterval = null;
            return;
        }
        const t = getEventTimeLeft();
        if (!t) {
            banner.remove();
            clearInterval(eventTimerInterval);
            eventTimerInterval = null;
            return;
        }
        const labelEl = banner.querySelector('.event-banner-timer-label');
        if (labelEl) labelEl.textContent = t.mode === 'before' ? 'До старта:' : 'До конца:';
        el.textContent = formatEventTime(t.diff);
    };
    tick();
    eventTimerInterval = setInterval(tick, 1000);
}

/* ═══════════════ НОРМАЛИЗАЦИЯ ═══════════════ */
function normalizeCaseItems(c) {
    if (c.keepLowPrice) return;
    c.items = c.items.map(normalizeItem);
    if (c.cheapPool) c.cheapPool = c.cheapPool.map(normalizeItem);
}
function normalizeItem(it) {
    if (it.currency === 'silver') return it;
    if (it.name !== 'Stars' && it.price < MIN_STARS_ITEM_PRICE) {
        return { ...it, name: 'Stars', isStars: true, currency: 'star' };
    }
    return it;
}

/* ═══════════════ БЕСПЛАТНЫЕ КЕЙСЫ ═══════════════ */
function getTodayDateStr() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
}
function getFreeCaseUsage() {
    try {
        const raw = localStorage.getItem(FREE_CASE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}
function saveFreeCaseUsage(usage) {
    localStorage.setItem(FREE_CASE_KEY, JSON.stringify(usage));
}
function getFreeCaseRemaining(c) {
    const cObj = (typeof c === 'object' && c !== null) ? c : CASES.find(x => x.id === c);
    if (!cObj || !cObj.free) return 0;
    if (cObj.freeType === 'unlimited') return Infinity;
    const usage = getFreeCaseUsage();
    const entry = usage[cObj.id];
    const today = getTodayDateStr();
    if (!entry || entry.date !== today) return FREE_CASE_LIMIT;
    return Math.max(0, FREE_CASE_LIMIT - (entry.count || 0));
}
function consumeFreeCase(caseId, qty = 1) {
    const cObj = CASES.find(x => x.id === caseId);
    if (!cObj) return false;
    if (cObj.freeType === 'unlimited') return true;
    const usage = getFreeCaseUsage();
    const today = getTodayDateStr();
    const entry = usage[caseId];
    if (!entry || entry.date !== today) {
        if (qty > FREE_CASE_LIMIT) return false;
        usage[caseId] = { date: today, count: qty };
    } else {
        if ((entry.count || 0) + qty > FREE_CASE_LIMIT) return false;
        entry.count = (entry.count || 0) + qty;
    }
    saveFreeCaseUsage(usage);
    return true;
}

function renderFreeCaseCard(card) {
    const priceEl = card.querySelector('.case-price');
    if (!priceEl) return;
    const caseId = parseInt(card.dataset.caseId);
    const c = CASES.find(x => x.id === caseId);
    if (!c || !c.free) return;
    if (c.freeType === 'unlimited') {
        priceEl.className = 'case-price free';
        priceEl.textContent = 'FREE';
        return;
    }
    const remaining = getFreeCaseRemaining(c.id);
    if (remaining <= 0) {
        priceEl.className = 'case-price cooldown';
        priceEl.textContent = 'Лимит';
    } else {
        priceEl.className = 'case-price free';
        priceEl.innerHTML = `FREE <span class="free-count">${remaining}/${FREE_CASE_LIMIT}</span>`;
    }
}

/* ═══════════════ ИНВЕНТАРЬ ═══════════════ */
function getInventory() {
    try {
        const inv = JSON.parse(localStorage.getItem('userInventory') || '[]');
        return Array.isArray(inv) ? inv : [];
    } catch (e) { return []; }
}

function cacheCollectionHistory(items) {
    try {
        const cached = JSON.parse(localStorage.getItem('userCollectionItems') || '[]');
        const names = new Map();
        const addName = item => {
            const name = typeof item === 'string' ? item : item?.name;
            if (typeof name !== 'string' || !name.trim()) return;
            const normalized = name.trim();
            const key = normalized.toLocaleLowerCase();
            if (!names.has(key)) names.set(key, normalized);
        };
        if (Array.isArray(cached)) cached.forEach(addName);
        items.forEach(addName);
        localStorage.setItem('userCollectionItems', JSON.stringify([...names.values()]));
    } catch (e) {
        console.error('[cases] collection history cache save failed:', e);
    }
}

async function saveInventory(nextInventory) {
    console.error('[cases] Generic inventory saves are disabled; use a server-owned operation.');
    return false;
}

/* ═══════════════ ИЗОБРАЖЕНИЯ ═══════════════ */
function getGiftImageByName(name, price, customImg) {
    if (customImg) return customImg;
    if (name === 'Stars') return getStarIcon();
    if (window.ROOT_ITEMS.has(name) || LOCAL_IMAGE_NAMES.has(name) || price < 3) {
        return name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.png';
    }
    const modelMatch = name.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (modelMatch) {
        return `${CDN}/${window.encodePathPart(modelMatch[1].trim())}/png/${window.encodePathPart(modelMatch[2].trim())}.png`;
    }
    return `${CDN}/${window.encodePathPart(name)}/png/Original.png`;
}
function getGiftLottieSafe(name, price, customImg) {
    if (customImg) return null;
    if (name === 'Stars') return null;
    if (window.ROOT_ITEMS.has(name) || LOCAL_IMAGE_NAMES.has(name) || price < 3) return null;
    const modelMatch = name.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (modelMatch) {
        return `${CDN}/${window.encodePathPart(modelMatch[1].trim())}/lottie/${window.encodePathPart(modelMatch[2].trim())}.json`;
    }
    return `${CDN}/${window.encodePathPart(name)}/lottie/Original.json`;
}
function getFullItems(c) { return [...(c.cheapPool || []), ...c.items]; }
function getCasePreview(items) { return [...items].sort((a, b) => b.price - a.price)[0]; }
function getCaseImage(c) {
    if (c.image) return c.image;
    const p = getCasePreview(c.items);
    return getGiftImageByName(p.name, p.price, p.image);
}

/* ═══════════════ STACKED CASE COMPOSITION ═══════════════ */
function buildStackedCaseImageHtml(c, fallbackImg, bgPath) {
    const gifts = getFullItems(c).slice().sort((a, b) => b.price - a.price);
    const top = gifts[0], second = gifts[1], third = gifts[2];
    const itemImg = (g) => {
        if (!g) return '';
        const src = getGiftImageByName(g.name, g.price, g.image);
        return `<img class="silver-case-item" src="${src}" alt="" loading="lazy"
                    onerror="this.onerror=null;this.src='${fallbackImg}'">`;
    };
    return `
        <div class="silver-case-stack">
            <img class="silver-case-bg" src="${bgPath}" alt=""
                 onerror="this.style.display='none'">
            <div class="silver-case-items">
                <div class="silver-case-slot left">${itemImg(third)}</div>
                <div class="silver-case-slot center">${itemImg(top)}</div>
                <div class="silver-case-slot right">${itemImg(second)}</div>
            </div>
        </div>`;
}

function buildSilverCaseImageHtml(c, fallbackImg) {
    return buildStackedCaseImageHtml(c, fallbackImg, `${CASE_IMG_PATH}silvercase.png`);
}
function buildHalloweenCaseImageHtml(c, fallbackImg) {
    return buildStackedCaseImageHtml(c, fallbackImg, `${CASE_IMG_PATH}halloweencase.png`);
}
function buildStarCaseImageHtml(c, fallbackImg) {
    return buildStackedCaseImageHtml(c, fallbackImg, `${CASE_IMG_PATH}starcase.png`);
}

/* ═══════════════ РЕНДЕР КЕЙСОВ ═══════════════ */
function renderCases() {
    const container = $('casesContainer');
    if (!container) return;
    let globalIdx = 0;
    let html = renderEventBanner();
    CATEGORIES.forEach(cat => {
        const list = CASES.filter(c => c.category === cat.key);
        if (!list.length) return;
        html += `<section class="cases-section"><div class="section-header"><div class="section-title">${cat.label}</div></div><div class="cases-grid">`;
        html += list.map(c => renderCaseCard(c, globalIdx++)).join('');
        html += `</div></section>`;
    });
    container.innerHTML = html;
    startEventTimer();
}

function renderCaseCard(c, idx) {
    const isFree = c.free === true;
    const currency = c.currency || 'star';
    const icon = getCurrencyIcon(currency);
    const caseImg = getCaseImage(c);
    const preview = getCasePreview(c.items);
    const fallbackImg = getGiftImageByName(preview.name, preview.price, preview.image);
    let badgeHtml = isFree
        ? `<div class="case-badge free">FREE</div>`
        : (c.badge === 'new' ? `<div class="case-badge new">NEW</div>` : '');
    const demoBtn = isFree ? '' : `<button class="case-demo-btn" onclick="event.stopPropagation();openDemoModal(${c.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>`;
    let priceHtml;
    if (isFree) {
        if (c.freeType === 'unlimited') {
            priceHtml = `<div class="case-price free">FREE</div>`;
        } else {
            const remaining = getFreeCaseRemaining(c.id);
            if (remaining <= 0) {
                priceHtml = `<div class="case-price cooldown">Лимит</div>`;
            } else {
                priceHtml = `<div class="case-price free">FREE <span class="free-count">${remaining}/${FREE_CASE_LIMIT}</span></div>`;
            }
        }
    } else {
        priceHtml = `<div class="case-price"><img src="${icon}" alt="">${window.formatStars(c.price)}</div>`;
    }
    let imageHtml;
    if (c.category === 'silver') {
        imageHtml = buildSilverCaseImageHtml(c, fallbackImg);
    } else if (c.category === 'halloween') {
        imageHtml = buildHalloweenCaseImageHtml(c, fallbackImg);
    } else if (c.useStarStack) {
        imageHtml = buildStarCaseImageHtml(c, fallbackImg);
    } else {
        imageHtml = `<img src="${caseImg}" alt="" onerror="this.onerror=null;this.src='${fallbackImg}';this.onerror=function(){this.src='${window.GIFT_FALLBACK}'}" loading="lazy">`;
    }
    const tierStyle = c.tier ? `style="--tier:${c.tier}"` : '';
    return `<div class="case-card ${isFree ? 'is-free' : ''}" style="animation-delay:${Math.min(idx * 35, 400)}ms; ${tierStyle}" ${isFree ? `data-free="1" data-case-id="${c.id}"` : ''} onclick="openCaseModal(${c.id})">${badgeHtml}${demoBtn}<div class="case-image">${imageHtml}</div><div class="case-name">${window.escapeHtml(c.name)}</div>${priceHtml}</div>`;
}

/* ═══════════════ МОДАЛКА ═══════════════ */
function openCaseModal(caseId) {
    if (isOpening) return;
    const found = CASES.find(c => c.id === caseId);
    if (!found) return;
    currentCase = found;
    isDemo = false;
    setOpening(false);
    selectedQty = 1;
    document.querySelectorAll('.qty-btn').forEach(b => b.classList.toggle('active', b.dataset.qty === '1'));
    renderModal();
    $('caseModal').classList.add('open', 'modal-open');
}

function openDemoModal(caseId) {
    if (isOpening) return;
    const found = CASES.find(c => c.id === caseId);
    if (!found || found.free) return;
    currentCase = found;
    isDemo = true;
    setOpening(false);
    selectedQty = 1;
    document.querySelectorAll('.qty-btn').forEach(b => b.classList.toggle('active', b.dataset.qty === '1'));
    renderModal();
    $('caseModal').classList.add('open', 'modal-open');
}

function setQty(q) {
    if (isOpening || isDemo) return;
    if (currentCase && !currentCase.free && currentCase.price * q > window.GameLimits.MAX_BET) return;
    if (currentCase && currentCase.free && currentCase.freeType === 'daily') {
        const remaining = getFreeCaseRemaining(currentCase.id);
        if (q > remaining) return;
    }
    selectedQty = q;
    document.querySelectorAll('.qty-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.qty) === q));
    if (currentCase) {
        if (currentCase.free) {
            renderFreeCaseOpenButton();
        } else {
            $('modalPrice').querySelector('span').textContent = window.formatStars(currentCase.price * q);
            updateOpenButton();
        }
    }
}

function updateQtyButtonsState() {
    if (!currentCase) return;
    const isFreeDaily = currentCase.free === true && currentCase.freeType === 'daily';
    const remaining = isFreeDaily ? getFreeCaseRemaining(currentCase.id) : Infinity;
    document.querySelectorAll('.qty-btn').forEach(b => {
        const q = parseInt(b.dataset.qty);
        const exceedsBetLimit = currentCase.free !== true && currentCase.price * q > window.GameLimits.MAX_BET;
        const disabled = (isFreeDaily && q > remaining) || exceedsBetLimit;
        b.classList.toggle('qty-disabled', disabled);
        b.style.pointerEvents = disabled ? 'none' : '';
    });
}

function renderModal() {
    if (!currentCase) return;
    const isFree = currentCase.free === true;
    const currency = currentCase.currency || 'star';
    const icon = getCurrencyIcon(currency);

    $('modalName').textContent = (isDemo ? '[ДЕМО] ' : '') + currentCase.name;
    if (isFree || isDemo) {
        $('modalPrice').querySelector('span').textContent = 'Бесплатно';
    } else {
        $('modalPrice').querySelector('img').src = icon;
        $('modalPrice').querySelector('span').textContent = window.formatStars(currentCase.price * selectedQty);
    }

    $('modalWin').style.display = 'none';
    $('modalWin').classList.remove('modal-win');
    $('rouletteWrap').style.display = 'block';
    $('rouletteWrap').innerHTML = `
        <div class="roulette-track idle" id="rouletteTrack"></div>
        <div class="roulette-pointer ptr-top"></div>
        <div class="roulette-pointer ptr-bottom"></div>`;
    $('rouletteWrap').classList.remove('won');
    $('contentsSection').style.display = 'block';
    $('qtyRow').style.display = isDemo ? 'none' : 'flex';
    $('openBtnWrap').style.display = 'block';
    updateQtyButtonsState();

    if (isFree) {
        renderFreeCaseOpenButton();
    } else {
        const btnLabel = isDemo ? 'Проиграть демо' : 'Открыть кейс';
        $('openBtnWrap').innerHTML = `<button class="open-btn" id="openBtn" onclick="openCase()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"></path></svg>${btnLabel}</button>`;
    }

    const fullItems = getFullItems(currentCase);
    const gifts = [...fullItems].sort((a, b) => b.price - a.price);

    const rouletteItems = [];
    for (let i = 0; i < 30; i++) {
        const g = gifts[i % gifts.length];
        const gc = getItemCurrency(g, currentCase);
        rouletteItems.push(`<div class="roulette-item"><div class="ri-price"><img src="${getCurrencyIcon(gc)}" alt="">${window.formatStars(g.price)}</div><img class="ri-img" src="${getGiftImageByName(g.name, g.price, g.image)}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'"></div>`);
    }
    const track = $('rouletteTrack');
    track.innerHTML = rouletteItems.join('') + rouletteItems.join('');
    track.classList.add('idle');
    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';

    $('contentsGrid').innerHTML = gifts.map((g, i) => {
        const gc = getItemCurrency(g, currentCase);
        const lottieUrl = getGiftLottieSafe(g.name, g.price, g.image);
        return `<div class="content-item" style="animation-delay:${i * 30}ms" data-lottie="${lottieUrl || ''}" onmouseenter="playLottie(this)" onmouseleave="stopLottie(this)"><div class="content-item-name">${window.escapeHtml(g.name)}</div><div class="content-item-media"><img src="${getGiftImageByName(g.name, g.price, g.image)}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'"><div class="lottie-box"></div></div><div class="content-price"><img src="${getCurrencyIcon(gc)}" alt=""> ${window.formatStars(g.price)}</div></div>`;
    }).join('');
}

function renderFreeCaseOpenButton() {
    const wrap = $('openBtnWrap');
    if (!wrap || !currentCase) return;
    const qty = selectedQty;

    if (currentCase.freeType === 'unlimited') {
        wrap.innerHTML = `<button class="open-btn" id="openBtn" onclick="openCase()">🎁 Открыть${qty > 1 ? ` ×${qty}` : ''}</button>`;
        return;
    }
    const remaining = getFreeCaseRemaining(currentCase.id);
    if (remaining <= 0) {
        wrap.innerHTML = `<button class="open-btn insufficient" disabled>Лимит на сегодня исчерпан</button>`;
    } else if (qty > remaining) {
        wrap.innerHTML = `<button class="open-btn insufficient" disabled>Доступно только ${remaining}</button>`;
    } else {
        wrap.innerHTML = `<button class="open-btn" id="openBtn" onclick="openCase()">🎁 Открыть${qty > 1 ? ` ×${qty}` : ''} (${remaining}/${FREE_CASE_LIMIT})</button>`;
    }
}

function updateOpenButton() {
    const btn = $('openBtn');
    if (!currentCase) return;
    if (isDemo) {
        if (btn) {
            btn.classList.remove('insufficient');
            btn.innerHTML = `Проиграть демо`;
        }
        return;
    }
    if (currentCase.free) {
        renderFreeCaseOpenButton();
        return;
    }
    if (!btn) return;
    const currency = currentCase.currency || 'star';
    const cost = currentCase.price * selectedQty;
    const balance = currency === 'silver' ? getSilver()
            : getStars();
    const label = currency === 'silver' ? 'серебра' : 'звёзд';
    if (cost > window.GameLimits.MAX_BET) {
        btn.classList.add('insufficient');
        btn.innerHTML = 'Максимальная сумма — 50 000 000';
    } else if (balance < cost) {
        btn.classList.add('insufficient');
        btn.innerHTML = `Недостаточно ${label}`;
    } else {
        btn.classList.remove('insufficient');
        btn.innerHTML = `Открыть кейс`;
    }
}

/* ═══════════════ БЛОКИРОВКА UI ═══════════════ */
function lockCaseUI(lock) {
    const modal = $('caseModal');
    if (!modal) return;
    modal.querySelectorAll('button, .qty-btn, .content-item, .roulette-item').forEach(el => {
        if (lock) {
            el.setAttribute('disabled', 'disabled');
            el.style.pointerEvents = 'none';
        } else {
            el.removeAttribute('disabled');
            el.style.pointerEvents = '';
        }
    });
    document.querySelectorAll('.bnav button').forEach(el => {
        if (lock) {
            el.setAttribute('disabled', 'disabled');
            el.style.pointerEvents = 'none';
            el.style.opacity = '0.4';
        } else {
            el.removeAttribute('disabled');
            el.style.pointerEvents = '';
            el.style.opacity = '';
        }
    });
}

/* ═══════════════ ОТКРЫТИЕ КЕЙСА ═══════════════ */
async function openCase() {
    if (!currentCase || isOpening) return;
    const isFree = currentCase.free === true;
    const currency = currentCase.currency || 'star';
    let paidCost = 0;
    let wonGifts = [];

    if (!isDemo) {
        if (!window.TG?.isTelegram || !window.LootStarAPI || !apiProfileReady) {
            showToast('Откройте игру в Telegram и дождитесь загрузки профиля', 'err');
            return;
        }
        const cost = isFree ? 0 : currentCase.price * selectedQty;
        if (cost > window.GameLimits.MAX_BET) {
            showToast('Максимальная сумма ставки — 50 000 000', 'err');
            return;
        }

        const storageKey = 'pendingCaseOpen';
        let pending;
        try {
            pending = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        } catch (error) {
            console.warn('[cases] pending request cache is invalid:', error);
        }
        if (!pending || pending.caseId !== currentCase.id || pending.quantity !== selectedQty) {
            pending = {
                caseId: currentCase.id,
                quantity: selectedQty,
                requestId: window.LootStarAPI.createRequestId()
            };
            sessionStorage.setItem(storageKey, JSON.stringify(pending));
        }

        isOpening = true;
        lockCaseUI(true);
        let result;
        try {
            result = await window.LootStarAPI.openCase(currentCase.id, selectedQty, pending.requestId);
        } catch (error) {
            console.error('[cases] server case opening failed:', error);
            if (error.status && error.status < 500) sessionStorage.removeItem(storageKey);
            isOpening = false;
            lockCaseUI(false);
            updateOpenButton();
            const message = error.code === 'INSUFFICIENT_FUNDS'
                ? `Недостаточно ${currency === 'silver' ? 'серебра' : 'звёзд'}`
                : error.code === 'FREE_CASE_LIMIT_REACHED'
                    ? 'Достигнут дневной лимит бесплатных открытий'
                    : error.code === 'ACCOUNT_BANNED'
                        ? 'Аккаунт заблокирован'
                        : error.code === 'BALANCE_SEASON_LOCKED' || error.code === 'BALANCE_POOL_EXHAUSTED'
                            ? 'Операции с балансом временно ограничены'
                            : 'Сервер не подтвердил открытие. Повторите попытку.';
            showToast(message, 'err');
            return;
        }

        sessionStorage.removeItem(storageKey);
        paidCost = cost;
        currentWinItems = result.items;
        wonGifts = result.gifts.map(gift => ({
            ...gift,
            image: gift.image || getGiftImageByName(gift.name, gift.price)
        }));
        window.LootStarAPI.applyCaseResult(result);
        updateBalance();
        window.refreshCurrencyUI();
        if (paidCost > 0 && window.RTP?.recordBet) window.RTP.recordBet(currency, paidCost);
    } else {
        isOpening = true;
        lockCaseUI(true);
        for (let i = 0; i < selectedQty; i++) {
            wonGifts.push(pickRandomGift(getFullItems(currentCase)));
        }
        currentWinItems = [];
    }

    if (!isDemo) {
        if (window.RTP?.recordPayout) {
            const total = wonGifts.reduce((s, g) => s + g.price, 0);
            window.RTP.recordPayout(currency, total);
        }
        window.LootTasks?.trackGameEvent({ game: 'cases', type: 'open', qty: selectedQty });
        wonGifts.forEach(g => pushLiveWin(g, getItemCurrency(g, currentCase), currentCase?.name));

    }

    runSpinRoulette(wonGifts);
}

/* ═══════════════ ВЫБОР ПРЕДМЕТА (со сливом) ═══════════════ */
function pickRandomGift(items) {
    // ── Обычный дроп ──
    const luck = window.Events ? window.Events.getLuck() : 1;
    const luckMultiplier = (luck > 1 ? (1 + (luck - 1) * 0.5) : 1) * 2;
    const casePrice = currentCase?.price || 0;

    let expensiveWeight = 0;
    let cheapBaseWeight = 0;

    const prepared = items.map(it => {
        const isExpensive = it.price >= casePrice;
        if (isExpensive) {
            const w = it.chance * luckMultiplier;
            expensiveWeight += w;
            return { ...it, finalWeight: w, isExpensive: true };
        } else {
            cheapBaseWeight += it.chance;
            return { ...it, finalWeight: it.chance, isExpensive: false };
        }
    });

    let expensiveTotalPct = Math.min(95, expensiveWeight);
    if (Number.isFinite(currentCase?.targetRtp)) {
        const expensiveExpectedValue = prepared.reduce(
            (sum, it) => sum + (it.isExpensive ? it.finalWeight * it.price : 0),
            0
        ) / expensiveWeight;
        const cheapExpectedValue = prepared.reduce(
            (sum, it) => sum + (it.isExpensive ? 0 : it.finalWeight * it.price),
            0
        ) / cheapBaseWeight;
        const targetExpensivePct = (
            casePrice * currentCase.targetRtp - cheapExpectedValue
        ) / (expensiveExpectedValue - cheapExpectedValue) * 100;

        if (Number.isFinite(targetExpensivePct) && targetExpensivePct >= 0 && targetExpensivePct <= 95) {
            expensiveTotalPct = targetExpensivePct;
        } else {
            console.error(`[cases] target RTP is unreachable for "${currentCase.name}"`);
        }
    }
    let cheapTotalPct = 100 - expensiveTotalPct;

    prepared.forEach(it => {
        if (it.isExpensive) {
            it.finalWeight = expensiveWeight > 0
                ? (it.finalWeight / expensiveWeight) * expensiveTotalPct
                : 0;
        } else {
            it.finalWeight = cheapBaseWeight > 0
                ? (it.chance / cheapBaseWeight) * cheapTotalPct
                : 0;
        }
    });

    let r = Math.random() * 100;
    for (const g of prepared) {
        r -= g.finalWeight;
        if (r <= 0) return g;
    }
    return prepared[prepared.length - 1];
}

/* ═══════════════ РУЛЕТКА ═══════════════ */
function runSpinRoulette(wonGifts) {
    const giftsArr = Array.isArray(wonGifts) ? wonGifts : [wonGifts];
    if (giftsArr.length > 1) { runMultiSpin(giftsArr); return; }

    const track = $('rouletteTrack');
    track.classList.remove('idle');
    track.classList.add('spinning');

    const pool = getFullItems(currentCase);
    const items = [];
    for (let i = 0; i < 50; i++) items.push(pool[Math.floor(Math.random() * pool.length)]);
    items[42] = giftsArr[0];

    track.innerHTML = items.map(g => {
        const gc = getItemCurrency(g, currentCase);
        return `<div class="roulette-item"><div class="ri-price"><img src="${getCurrencyIcon(gc)}" alt="">${window.formatStars(g.price)}</div><img class="ri-img" src="${getGiftImageByName(g.name, g.price, g.image)}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'"></div>`;
    }).join('');

    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
    void track.offsetWidth;

    requestAnimationFrame(() => {
        const firstItem = track.querySelector('.roulette-item');
        if (!firstItem) return;
        const itemRect = firstItem.getBoundingClientRect();
        const wrapRect = $('rouletteWrap').getBoundingClientRect();
        const step = itemRect.width + 8;
        const targetCenter = 6 + step * 42 + itemRect.width / 2;
        const offset = wrapRect.width / 2 - targetCenter;
        track.style.transition = 'transform 4s cubic-bezier(0.15, 0.85, 0.15, 1)';
        track.style.transform = `translateX(${offset}px)`;
    });

    let spinVibCount = 0;
    spinInterval = setInterval(() => {
        window.vibrate('light');
        spinVibCount++;
        if (spinVibCount > 8) clearInterval(spinInterval);
    }, 450);

    const onTransitionEnd = (e) => {
        if (e.propertyName !== 'transform') return;
        track.removeEventListener('transitionend', onTransitionEnd);
        if (spinInterval) { clearInterval(spinInterval); spinInterval = null; }
        if (!isOpening) return;
        window.vibrate('success');
        setTimeout(() => { if (isOpening) showWinResultInModal(giftsArr); }, 300);
    };
    track.addEventListener('transitionend', onTransitionEnd);

    setTimeout(() => {
        if (isOpening) {
            if (spinInterval) { clearInterval(spinInterval); spinInterval = null; }
            showWinResultInModal(giftsArr);
        }
    }, 5000);
}

function runMultiSpin(wonGifts) {
    const wrap = $('rouletteWrap');
    wrap.innerHTML = '';
    wrap.style.display = 'block';

    wonGifts.forEach((gift, idx) => {
        const row = document.createElement('div');
        row.className = 'multi-roulette-row';
        row.innerHTML = `<div class="roulette-track spinning"></div><div class="roulette-pointer ptr-top"></div><div class="roulette-pointer ptr-bottom"></div>`;
        wrap.appendChild(row);

        const track = row.querySelector('.roulette-track');
        const pool = getFullItems(currentCase);
        const items = [];
        for (let i = 0; i < 50; i++) items.push(pool[Math.floor(Math.random() * pool.length)]);
        items[42] = gift;

        track.innerHTML = items.map(g => {
            const gc = getItemCurrency(g, currentCase);
            return `<div class="roulette-item"><div class="ri-price"><img src="${getCurrencyIcon(gc)}" alt="">${window.formatStars(g.price)}</div><img class="ri-img" src="${getGiftImageByName(g.name, g.price, g.image)}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'"></div>`;
        }).join('');

        track.style.transition = 'none';
        track.style.transform = 'translateX(0)';

        const delay = idx * 300;
        const duration = 5000 + idx * 300;

        setTimeout(() => {
            if (!isOpening) return;
            requestAnimationFrame(() => {
                if (!isOpening) return;
                const firstItem = track.querySelector('.roulette-item');
                if (!firstItem) return;
                const itemRect = firstItem.getBoundingClientRect();
                const rowRect = row.getBoundingClientRect();
                const step = itemRect.width + 8;
                const targetCenter = 6 + step * 42 + itemRect.width / 2;
                const offset = rowRect.width / 2 - targetCenter;
                track.style.transition = `transform ${duration}ms cubic-bezier(0.15, 0.85, 0.15, 1)`;
                track.style.transform = `translateX(${offset}px)`;
            });
        }, delay);
    });

    let vc = 0;
    const vi = setInterval(() => { window.vibrate('light'); vc++; if (vc > 10) clearInterval(vi); }, 400);
    setTimeout(() => {
        clearInterval(vi);
        if (!isOpening) return;
        window.vibrate('success');
        showWinResultInModal(wonGifts);
    }, 5000 + (wonGifts.length - 1) * 300 + 400);
}

/* ═══════════════ СОХРАНЕНИЕ В ИНВЕНТАРЬ ═══════════════ */
function saveWinToInventory(gift) {
    const currency = getItemCurrency(gift, currentCase);
    const value = Math.round(gift.price);
    const savedItem = {
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: gift.name,
        price: gift.price,
        stars: value,
        value: value,
        currency,
        image: getGiftImageByName(gift.name, gift.price, gift.image),
        isStars: gift.isStars === true || gift.name === 'Stars',
        owned: true,
        timestamp: Date.now()
    };
    return savedItem;
}

/* ═══════════════ ПОБЕДА В МОДАЛКЕ ═══════════════ */
function showWinResultInModal(giftsArr) {
    const lastDrop = { gifts: giftsArr, items: currentWinItems, demo: isDemo, ts: Date.now() };
    if (!isDemo) localStorage.setItem('lastDrop', JSON.stringify(lastDrop));

    $('rouletteWrap').classList.add('won');
    $('openBtnWrap').style.display = 'none';
    $('contentsSection').style.display = 'none';
    $('qtyRow').style.display = 'none';

    destroyWinLottie();

    const demoBadge = isDemo ? '<div class="modal-win-demo-badge">Демо-режим — выигрыш не начислен</div>' : '';

    if (giftsArr.length > 1) {
        const totalValue = giftsArr.reduce((s, g) => s + g.price, 0);
        $('modalWin').innerHTML = `
            <div style="text-align:center;padding:10px 0;">
                ${demoBadge}
                <div style="font-size:14px;color:var(--jade);margin-bottom:12px;font-weight:700;">Вы выиграли ${giftsArr.length} подарков!</div>
                <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:12px;">
                    ${giftsArr.map(g => `
                        <div style="background:var(--panel-2);border:1px solid var(--hairline);border-radius:14px;padding:8px;width:80px;text-align:center;">
                            <img src="${getGiftImageByName(g.name, g.price, g.image)}" style="width:50px;height:50px;object-fit:contain;" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'">
                            <div style="font-size:11px;color:var(--amber-2);margin-top:4px;font-weight:800;">${window.formatStars(g.price)}</div>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-bottom:14px;font-weight:800;">Итого: ${window.formatStars(totalValue)}</div>
                <div class="modal-win-btns">
                    ${isDemo
                ? `<button class="modal-win-btn" onclick="closeModalAndReset()">Закрыть</button>`
                : `<button class="modal-win-btn sell" onclick="sellCurrentWin()">Продать</button>
                           <button class="modal-win-btn upgrade" onclick="upgradeCurrentWin()">Апгрейд</button>
                           <button class="modal-win-btn" onclick="closeModalAndReset()">Назад</button>`}
                </div>
            </div>`;
    } else {
        const gift = giftsArr[0];
        const currency = getItemCurrency(gift, currentCase);
        $('modalWin').innerHTML = `
            ${demoBadge}
            <div class="modal-win-badge">Вы выиграли!</div>
            <div class="modal-win-media" id="modalWinMedia">
                <img class="modal-win-img" id="modalWinImg" src="${getGiftImageByName(gift.name, gift.price, gift.image)}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'">
            </div>
            <div class="modal-win-name">${window.escapeHtml(gift.name)}</div>
            <div class="modal-win-value">
                <img src="${getCurrencyIcon(currency)}" alt=""><span>${window.formatStars(gift.price)}</span>
            </div>
            <div class="modal-win-btns">
                ${isDemo
                ? `<button class="modal-win-btn" onclick="closeModalAndReset()">Закрыть</button>`
                : `<button class="modal-win-btn sell" onclick="sellCurrentWin()">Продать</button>
                       <button class="modal-win-btn upgrade" onclick="upgradeCurrentWin()">Апгрейд</button>
                       <button class="modal-win-btn" onclick="closeModalAndReset()">Назад</button>`}
            </div>`;
    }

    $('modalWin').style.display = 'block';
    $('modalWin').classList.add('modal-win');
    setOpening(false);
}

/* ═══════════════ ВОССТАНОВЛЕНИЕ ДРОПА ═══════════════ */
function restoreLastDrop() {
    const raw = localStorage.getItem('lastDrop');
    if (!raw) return;
    try {
        const data = JSON.parse(raw);
        if (data.demo) { localStorage.removeItem('lastDrop'); return; }
        if (Date.now() - data.ts > 5 * 60 * 1000) { localStorage.removeItem('lastDrop'); return; }
        currentWinItems = data.items || [];
        showToast('Последний дроп сохранён — откройте инвентарь', 'ok');
    } catch (e) { }
}

function destroyWinLottie() {
    const old = document.querySelector('.modal-win-lottie');
    if (old) old.remove();
    const img = $('modalWinImg');
    if (img) img.style.visibility = 'visible';
}

/* ═══════════════ ПРОДАТЬ / АПГРЕЙД ═══════════════ */
async function sellCurrentWin() {
    if (isOpening || isDemo) return;
    if (_winSellInProgress) return;
    if (!currentWinItems.length) { closeModalAndReset(); return; }

    const sellable = currentWinItems.filter(it =>
        it.noSell !== true && it.untradeable !== true && it.limited !== true
    );
    if (!sellable.length) {
        showToast('Эти предметы нельзя продать', 'err');
        return;
    }
    const estimatedSaleValue = sellable.reduce((sum, item) =>
        sum + (Number(item.stars || item.value) || Math.round((Number(item.price) || 0) * 125)), 0);
    if (estimatedSaleValue >= 1_000_000 &&
        !confirm(`Продать выигрыш стоимостью ${window.formatStars(estimatedSaleValue)}?`)) {
        return;
    }

    _winSellInProgress = true;
    if (!apiProfileReady || !window.LootStarAPI) {
        _winSellInProgress = false;
        showToast('Не удалось связаться с сервером игры', 'err');
        return;
    }

    let result;
    try {
        result = await window.LootStarAPI.sellItems(sellable.map(item => item.id));
    } catch (error) {
        console.error('[cases] server item sale failed:', error);
        _winSellInProgress = false;
        showToast(error.code === 'ITEMS_NOT_FOUND' ? 'Предмет уже продан или не найден' : 'Не удалось сохранить продажу', 'err');
        return;
    }

    window.LootStarAPI.applyInventoryResult(result);
    const totalStars = Number(result.starsEarned) || 0;
    const totalSilver = Number(result.silverEarned) || 0;
    window.refreshCurrencyUI();
    showToast(`Продано: ${window.formatStars(totalStars)} ⭐ + ${window.formatStars(totalSilver)} серебра`, 'ok');
    currentWinItems = [];
    localStorage.removeItem('lastDrop');
    _winSellInProgress = false;
    closeModalAndReset();
}

function upgradeCurrentWin() {
    if (isOpening || isDemo) return;
    destroyWinLottie();
    closeModal();
    location.href = 'upgrades/index.html';
}

function closeModalAndReset() {
    if (isOpening) return;
    destroyWinLottie();
    if (!isDemo) localStorage.removeItem('lastDrop');
    closeModal();
    isDemo = false;
    renderCases();
    updateBalance();
}

function closeModal() {
    if (isOpening) return;
    destroyWinLottie();
    $('caseModal').classList.remove('open', 'modal-open');
    currentCase = null;
    isDemo = false;
}

/* ═══════════════ ЗАКРЫТИЕ ПО КЛИКУ НА ОВЕРЛЕЙ ═══════════════ */
$('caseModal') && $('caseModal').addEventListener('click', e => {
    if (e.target !== $('caseModal')) return;
    const wasFree = currentCase && currentCase.free === true;
    if (isOpening) {
        if (spinInterval) { clearInterval(spinInterval); spinInterval = null; }
        isOpening = false;
        lockCaseUI(false);
        destroyWinLottie();
        $('caseModal').classList.remove('open', 'modal-open');
        currentCase = null;
        isDemo = false;
        showToast('Предмет сохранён в инвентарь', 'ok');
        renderCases();
    } else {
        closeModal();
        if (wasFree) renderCases();
    }
});

function setOpening(v) {
    isOpening = v;
    lockCaseUI(v);
    if (!v) {
        const btn = $('openBtn');
        if (btn) btn.disabled = false;
        document.querySelectorAll('.qty-btn').forEach(b => b.classList.remove('locked'));
    }
}

function showToast(msg, type = 'ok') {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    setTimeout(() => toast.classList.remove('show'), 2500);
}

/* ═══════════════ LOTTIE ═══════════════ */
function playLottie(el) {
    const url = el.dataset.lottie;
    if (!url) return;
    const box = el.querySelector('.lottie-box');
    if (!box || box.dataset.playing === '1') return;
    box.dataset.playing = '1';
    el.classList.add('playing-lottie');
    if (!box._anim) {
        box._anim = lottie.loadAnimation({ container: box, renderer: 'svg', loop: true, autoplay: true, path: url });
    } else {
        box._anim.play();
    }
}
function stopLottie(el) {
    const box = el.querySelector('.lottie-box');
    if (!box) return;
    el.classList.remove('playing-lottie');
    if (box._anim) { try { box._anim.stop(); } catch (e) { } }
    box.dataset.playing = '0';
}

/* ═══════════════ ЛЕНТА LIVE-ВЫИГРЫШЕЙ ═══════════════ */
const LIVE_WINS_LIMIT = 20;
const LIVE_WINS_MIN_PRICE = 1;
let liveWinsCache = [];
let liveWinsPollTimer = null;
let liveWinsRequestInFlight = false;

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') initLiveWinsFeed();
    else stopLiveWinsFeed();
});
window.addEventListener('pagehide', stopLiveWinsFeed);
window.addEventListener('pageshow', initLiveWinsFeed);

function liveWinChipHtml(entry) {
    const giftImg = entry.image || getGiftImageByName(entry.name, entry.price || 0);
    const count = Math.max(1, Number(entry.count) || 1);
    const caseName = window.escapeHtml(entry.caseName || 'Кейс не указан');
    const itemName = window.escapeHtml(entry.name || 'Предмет');
    return `<div class="live-win-chip" title="Из кейса: ${caseName}" aria-label="${itemName}, x${count}. Из кейса: ${caseName}" tabindex="0">
        <img class="lw-item" src="${giftImg}" alt="${itemName}" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'">
        <span class="lw-count">x${count}</span>
    </div>`;
}
function renderLiveWinsTrack(entries) {
    const track = $('liveWinsTrack');
    if (!track) return;
    if (!entries.length) { track.innerHTML = ''; return; }
    const grouped = new Map();
    entries.forEach(entry => {
        const key = [entry.image || entry.name || '', entry.caseName || ''].join('\u0000');
        const previous = grouped.get(key);
        if (previous) previous.count += Math.max(1, Number(entry.count) || 1);
        else grouped.set(key, { ...entry, count: Math.max(1, Number(entry.count) || 1) });
    });
    const html = [...grouped.values()].map(liveWinChipHtml).join('');
    track.innerHTML = `<div class="live-wins-inner">${html}${html}</div>`;
}
function initLiveWinsFeed() {
    if (document.visibilityState !== 'visible') {
        stopLiveWinsFeed();
        return;
    }
    if (!window.TG?.isTelegram) {
        stopLiveWinsFeed();
        renderLiveWinsTrack([]);
        return;
    }

    if (liveWinsPollTimer) return;
    refreshLiveWins();
    liveWinsPollTimer = window.setInterval(refreshLiveWins, 10000);
}
function stopLiveWinsFeed() {
    if (liveWinsPollTimer) {
        window.clearInterval(liveWinsPollTimer);
        liveWinsPollTimer = null;
    }
}
async function refreshLiveWins() {
    if (liveWinsRequestInFlight) return;
    if (!window.LootStarAPI?.getLiveWins) {
        console.error('[liveWins] API client is unavailable');
        return;
    }
    liveWinsRequestInFlight = true;
    try {
        const result = await window.LootStarAPI.getLiveWins(LIVE_WINS_LIMIT);
        if (!Array.isArray(result?.wins)) throw new Error('INVALID_LIVE_WINS_RESPONSE');
        liveWinsCache = result.wins;
        renderLiveWinsTrack(liveWinsCache);
    } catch (error) {
        console.warn('[liveWins] API refresh failed:', error);
    } finally {
        liveWinsRequestInFlight = false;
    }
}
function pushLiveWin(gift, currency, caseName) {
    if (!gift || (gift.price || 0) < LIVE_WINS_MIN_PRICE) return;
    const entry = {
        name: gift.name,
        price: gift.price,
        currency: currency || 'star',
        caseName: caseName || '',
        image: getGiftImageByName(gift.name, gift.price, gift.image)
    };
    liveWinsCache = [entry, ...liveWinsCache].slice(0, LIVE_WINS_LIMIT);
    renderLiveWinsTrack(liveWinsCache);
}

/* ═══════════════ ЭКСПОРТ ═══════════════ */
window.openCaseModal = openCaseModal;
window.openDemoModal = openDemoModal;
window.setQty = setQty;
window.openCase = openCase;
window.closeModalAndReset = closeModalAndReset;
window.closeModal = closeModal;
window.sellCurrentWin = sellCurrentWin;
window.upgradeCurrentWin = upgradeCurrentWin;
window.playLottie = playLottie;
window.stopLottie = stopLottie;
window.getInventory = getInventory;
window.saveInventory = saveInventory;
window.showToast = showToast;
window.getSilver = getSilver;
window.getStars = getStars;
window.getCurrencyIcon = getCurrencyIcon;
window.getFreeCaseRemaining = getFreeCaseRemaining;
window.consumeFreeCase = consumeFreeCase;
window.handleEventBannerClick = handleEventBannerClick;