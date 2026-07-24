export const DEFAULT_STYLE = [
  "ultra-vibrant premium cinematic 3D animation",
  "stylized realism with believable materials and expressive characters",
  "extravagant large-scale environments",
  "rich global illumination and luminous atmospheric depth",
  "crisp subject separation and social-first composition",
  "high-detail polished animated-film finish",
  "vivid color depth without blown highlights",
  "emotionally captivating, premium, cohesive art direction"
].join(", ");

const SETTINGS = [
  "tropical surf paradise with luminous turquoise water, giant rolling waves, lush cliffs and towering clouds",
  "Japanese countryside at peak cherry blossom season with mountain villages, rice fields and warm sunrise haze",
  "futuristic coastal dream city with glass towers, gardens, elevated transit and glowing sunset reflections",
  "alpine valley with wildflowers, waterfalls, crystal lakes and enormous snow-covered peaks",
  "fantasy kingdom of floating islands, cascading waterfalls, glowing forests and distant castles",
  "Mediterranean cliffside town with scooters, stone terraces, bougainvillea and sparkling ocean light",
  "snowy storybook village with warm lanterns, powder-covered roofs and cinematic winter mountains",
  "bioluminescent jungle with giant flowers, crystal rivers, floating spores and soft blue mist"
];

const DOGS = [
  "fluffy golden retriever with a joyful face, expressive eyes and a red adventure bandana",
  "tiny cream dachshund with oversized confidence, bright eyes and a teal scarf",
  "black-and-tan shiba inu with an alert expression and sleek travel harness",
  "curly apricot doodle with a playful expression and tiny aviator goggles",
  "majestic blue-merle Australian shepherd with bright eyes and a compact travel satchel",
  "small white terrier with expressive ears and a vintage neckerchief"
];

const PEOPLE = [
  "stylish young traveler in a modern cream jacket and elevated relaxed streetwear",
  "adventurous woman in a flowing red coat with a confident cinematic silhouette",
  "retro-futurist explorer in tailored pastel travel gear",
  "fashion-forward traveler with windswept hair and minimal luxury styling",
  "charismatic skateboard traveler in elevated casual fashion",
  "cinematic wanderer in a bright statement jacket with premium editorial styling"
];

const STYLE_TWISTS = [
  "sun-drenched optimistic adventure",
  "luxury travel campaign energy",
  "playful oversized-world spectacle",
  "dreamlike emotional wonder",
  "fast kinetic social hook",
  "surreal premium visual surprise"
];

const STRATEGIES = [
  { label: "Literal", score: 82, note: "Closest to the brief; safest baseline.", treatment: "clear readable composition, faithful to the requested character and setting" },
  { label: "Cinematic", score: 94, note: "Best default for premium short-form content.", treatment: "dramatic hero framing, strong depth, controlled rim light and cinematic scale" },
  { label: "Scenic", score: 89, note: "Best for showing an extravagant world.", treatment: "wide establishing composition with the character clearly readable against a breathtaking environment" },
  { label: "Action", score: 91, note: "Strong motion potential for video conversion.", treatment: "dynamic pose, directional movement, low tracking-camera energy and strong motion cues" },
  { label: "Emotional", score: 87, note: "Best for connection, gifts and memorial-style stories.", treatment: "intimate expressive moment, warm light and emotionally resonant storytelling" },
  { label: "Wildcard", score: 90, note: "Pushes for a standout social hook without losing the brand look.", treatment: "unexpected but coherent premium visual twist, iconic silhouette and immediate scroll-stopping spectacle" }
];

function normalize(value, fallback) {
  return String(value || "").trim() || fallback;
}

export function inspirationIdeas(kind = "dog") {
  const pool = kind === "person" ? PEOPLE : DOGS;
  return Array.from({ length: 6 }, (_, i) => {
    const character = pool[i % pool.length];
    const setting = SETTINGS[(i * 3 + (kind === "person" ? 1 : 0)) % SETTINGS.length];
    const styleTwist = STYLE_TWISTS[i];
    const prompt = `${character}, traveling through ${setting}, ${styleTwist}, ${DEFAULT_STYLE}`;
    return {
      id: `inspiration-${kind}-${i + 1}`,
      label: ["Most Marketable", "High Motion", "World Builder", "Emotional", "Social Hook", "Wildcard"][i],
      character,
      setting,
      mood: ["joyful", "adventurous", "awe-inspiring", "heartwarming", "energetic", "surreal"][i],
      styleTwist,
      score: [95, 92, 90, 88, 93, 89][i],
      prompt
    };
  });
}

export function strategicVariations({ character, setting, mood, style }) {
  const finalCharacter = normalize(character, "a charismatic adventurous dog with expressive eyes");
  const finalSetting = normalize(setting, SETTINGS[0]);
  const finalMood = normalize(mood, "joyful, awe-inspiring and adventurous");
  const finalStyle = normalize(style, DEFAULT_STYLE);
  const base = `${finalCharacter} in ${finalSetting}, mood: ${finalMood}`;

  return STRATEGIES.map((strategy, i) => ({
    id: `concept-${i + 1}`,
    label: strategy.label,
    score: strategy.score,
    recommendation: strategy.note,
    prompt: `${base}, ${strategy.treatment}, ${finalStyle}`
  }));
}

export function recommendConcept(concepts = []) {
  return [...concepts].sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
}

export function makeStoryboard(concept, seconds = 30) {
  if (!concept?.prompt) throw new Error("A selected concept with a prompt is required.");
  const total = Math.max(18, Math.min(60, Number(seconds) || 30));
  const durations = Array(6).fill(Number((total / 6).toFixed(1)));
  const difference = Number((total - durations.reduce((a, b) => a + b, 0)).toFixed(1));
  durations[5] = Number((durations[5] + difference).toFixed(1));

  const beats = [
    { name: "Hook", beat: "Immediate scroll-stopping hero reveal that establishes the character and impossible scale of the world", camera: "fast cinematic reveal into a controlled hero composition" },
    { name: "Departure", beat: "Character begins moving through the environment with a clear destination or sense of discovery", camera: "smooth tracking movement with strong foreground parallax" },
    { name: "Escalation", beat: "The world becomes larger and more extravagant while the character remains visually dominant and consistent", camera: "wide dynamic travel shot with readable character silhouette" },
    { name: "Personality", beat: "Brief expressive close moment that creates attachment to the character before the payoff", camera: "gentle push-in or orbit, controlled depth of field" },
    { name: "Payoff", beat: "Largest action or scenic spectacle of the short, designed as the memorable shareable moment", camera: "high-energy cinematic movement with stable subject identity" },
    { name: "Loop", beat: "Satisfying final image whose direction, lighting or motion can flow naturally back toward the opening shot", camera: "elegant pullback or circular movement that supports a seamless loop" }
  ];

  return beats.map((scene, index) => ({
    scene: index + 1,
    name: scene.name,
    beat: scene.beat,
    camera: scene.camera,
    duration: durations[index],
    prompt: `${concept.prompt}. Scene ${index + 1} — ${scene.name}: ${scene.beat}. Camera: ${scene.camera}. Preserve exact character identity, proportions, wardrobe/accessories, palette and world continuity. No duplicate subject, no anatomy changes, no random costume changes.`
  }));
}

export function buildRenderPlan(project) {
  if (!project?.storyboard?.length) throw new Error("Storyboard is required before a render plan can be created.");
  const maxRetries = project.costGuardrails?.maxRetriesPerShot ?? 2;
  return {
    provider: "higgsfield",
    mode: "approval-gated",
    stages: [
      { id: "concept-stills", label: "Concept stills", purpose: "Generate low-cost visual candidates before any video spend.", count: 6, approvalRequired: true },
      { id: "scene-keyframes", label: "Approved scene keyframes", purpose: "Lock identity, composition and continuity for each storyboard scene.", count: project.storyboard.length, approvalRequired: true },
      { id: "scene-video", label: "Video clips", purpose: "Animate only approved keyframes and retry only failed scenes.", count: project.storyboard.length, maxRetriesPerShot: maxRetries, approvalRequired: true },
      { id: "assembly", label: "Final assembly", purpose: "Stitch approved clips, add music, normalize and export social versions.", count: 1, approvalRequired: false }
    ]
  };
}
