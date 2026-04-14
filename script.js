const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const bestScoreElement = document.getElementById("best-score");
const gravityLabelElement = document.getElementById("gravity-label");
const coreCountElement = document.getElementById("core-count");
const levelLabelElement = document.getElementById("level-label");
const objectiveLabelElement = document.getElementById("objective-label");
const finalScoreElement = document.getElementById("final-score");
const startOverlay = document.getElementById("start-overlay");
const gameOverOverlay = document.getElementById("game-over-overlay");
const startButton = document.getElementById("start-button");
const restartButton = document.getElementById("restart-button");

const DIRECTIONS = ["down", "up", "left", "right"];
const DIRECTION_LABELS = {
  down: "Down",
  up: "Up",
  left: "Left",
  right: "Right",
};

class InputManager {
  constructor() {
    this.keys = new Set();
    window.addEventListener("keydown", (event) => this.keys.add(event.key.toLowerCase()));
    window.addEventListener("keyup", (event) => this.keys.delete(event.key.toLowerCase()));
  }

  isPressed(...codes) {
    return codes.some((code) => this.keys.has(code));
  }

  consumePress(...codes) {
    for (const code of codes) {
      if (this.keys.has(code)) {
        this.keys.delete(code);
        return true;
      }
    }

    return false;
  }
}

class SoundManager {
  constructor() {
    this.context = null;
  }

  // Lazily create audio so the browser can unlock it from a user gesture.
  ensureContext() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (this.context.state === "suspended") {
      this.context.resume();
    }
  }

  playTone({ frequency, duration = 0.12, type = "sine", volume = 0.05, glideTo = null }) {
    if (!window.AudioContext && !window.webkitAudioContext) {
      return;
    }

    this.ensureContext();

    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gainNode = this.context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);

    if (glideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(glideTo, now + duration);
    }

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gainNode);
    gainNode.connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  playStart() {
    this.playTone({ frequency: 420, duration: 0.12, type: "triangle", volume: 0.04, glideTo: 620 });
    setTimeout(() => {
      this.playTone({ frequency: 620, duration: 0.18, type: "triangle", volume: 0.04, glideTo: 780 });
    }, 70);
  }

  playGravityShift() {
    this.playTone({ frequency: 260, duration: 0.18, type: "sawtooth", volume: 0.03, glideTo: 180 });
  }

  playGameOver() {
    this.playTone({ frequency: 220, duration: 0.35, type: "square", volume: 0.04, glideTo: 80 });
  }

  playCorePickup() {
    this.playTone({ frequency: 540, duration: 0.1, type: "triangle", volume: 0.03, glideTo: 760 });
  }

  playDash() {
    this.playTone({ frequency: 160, duration: 0.1, type: "sawtooth", volume: 0.04, glideTo: 420 });
  }

  playFocus() {
    this.playTone({ frequency: 310, duration: 0.22, type: "triangle", volume: 0.035, glideTo: 510 });
  }

  playPowerUp() {
    this.playTone({ frequency: 480, duration: 0.14, type: "triangle", volume: 0.03, glideTo: 840 });
  }

  playLevelUp() {
    this.playTone({ frequency: 520, duration: 0.12, type: "triangle", volume: 0.04, glideTo: 760 });
    setTimeout(() => {
      this.playTone({ frequency: 760, duration: 0.16, type: "triangle", volume: 0.04, glideTo: 980 });
    }, 80);
  }

  playShieldBreak() {
    this.playTone({ frequency: 680, duration: 0.12, type: "square", volume: 0.03, glideTo: 240 });
  }
}

class Player {
  constructor(bounds) {
    this.bounds = bounds;
    this.radius = 16;
    this.reset();
  }

  reset() {
    this.x = this.bounds.width / 2;
    this.y = this.bounds.height / 2;
    this.vx = 0;
    this.vy = 0;
    this.rotation = 0;
    this.trail = [];
    this.dashGlow = 0;
    this.shieldPulse = 0;
  }

  update(deltaTime, gravityVector, input, difficulty) {
    const moveAcceleration = 1200;
    const maxSpeed = 370 + difficulty * 18;
    const gravityStrength = 520 + difficulty * 28;
    const drag = 0.985;

    // Manual thrust lets the player fight against whichever way gravity points.
    if (input.isPressed("arrowleft", "a")) {
      this.vx -= moveAcceleration * deltaTime;
    }
    if (input.isPressed("arrowright", "d")) {
      this.vx += moveAcceleration * deltaTime;
    }
    if (input.isPressed("arrowup", "w")) {
      this.vy -= moveAcceleration * deltaTime;
    }
    if (input.isPressed("arrowdown", "s")) {
      this.vy += moveAcceleration * deltaTime;
    }

    this.vx += gravityVector.x * gravityStrength * deltaTime;
    this.vy += gravityVector.y * gravityStrength * deltaTime;
    this.vx *= drag;
    this.vy *= drag;

    const speed = Math.hypot(this.vx, this.vy);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      this.vx *= scale;
      this.vy *= scale;
    }

    this.x += this.vx * deltaTime;
    this.y += this.vy * deltaTime;
    this.rotation += (speed * 0.003 + difficulty * 0.01) * deltaTime * 60;
    this.dashGlow = Math.max(0, this.dashGlow - deltaTime * 3.2);
    this.shieldPulse += deltaTime * 4;

    this.keepInsideArena();
    this.pushTrail();
  }

  dash(directionX, directionY) {
    const magnitude = Math.hypot(directionX, directionY) || 1;
    const dashSpeed = 420;
    this.vx += (directionX / magnitude) * dashSpeed;
    this.vy += (directionY / magnitude) * dashSpeed;
    this.dashGlow = 1;
  }

  keepInsideArena() {
    const bounce = 0.58;

    if (this.x - this.radius < 0) {
      this.x = this.radius;
      this.vx = Math.abs(this.vx) * bounce;
    } else if (this.x + this.radius > this.bounds.width) {
      this.x = this.bounds.width - this.radius;
      this.vx = -Math.abs(this.vx) * bounce;
    }

    if (this.y - this.radius < 0) {
      this.y = this.radius;
      this.vy = Math.abs(this.vy) * bounce;
    } else if (this.y + this.radius > this.bounds.height) {
      this.y = this.bounds.height - this.radius;
      this.vy = -Math.abs(this.vy) * bounce;
    }
  }

  pushTrail() {
    this.trail.push({ x: this.x, y: this.y, alpha: 1 });
    if (this.trail.length > 12) {
      this.trail.shift();
    }

    for (const point of this.trail) {
      point.alpha *= 0.88;
    }
  }

  draw(context) {
    for (const point of this.trail) {
      context.beginPath();
      context.fillStyle = `rgba(116, 242, 255, ${point.alpha * 0.16})`;
      context.arc(point.x, point.y, this.radius * 0.85, 0, Math.PI * 2);
      context.fill();
    }

    context.save();
    context.translate(this.x, this.y);
    context.rotate(this.rotation);

    const halo = context.createRadialGradient(0, 0, 2, 0, 0, this.radius * 2.5);
    halo.addColorStop(0, "rgba(152, 255, 203, 0.55)");
    halo.addColorStop(1, "rgba(152, 255, 203, 0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(0, 0, this.radius * 2.4, 0, Math.PI * 2);
    context.fill();

    if (this.dashGlow > 0) {
      context.beginPath();
      context.fillStyle = `rgba(255, 197, 109, ${this.dashGlow * 0.4})`;
      context.arc(0, 0, this.radius * 2.9, 0, Math.PI * 2);
      context.fill();
    }

    context.beginPath();
    context.fillStyle = "#ecfeff";
    context.arc(0, 0, this.radius, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.fillStyle = "#0c1b34";
    context.moveTo(0, -this.radius * 0.9);
    context.lineTo(this.radius * 0.7, this.radius * 0.8);
    context.lineTo(-this.radius * 0.7, this.radius * 0.8);
    context.closePath();
    context.fill();

    context.restore();
  }
}

class Obstacle {
  constructor(x, y, size, velocityX, velocityY, hue) {
    this.x = x;
    this.y = y;
    this.size = size;
    this.vx = velocityX;
    this.vy = velocityY;
    this.rotation = Math.random() * Math.PI * 2;
    this.spin = (Math.random() * 2 - 1) * 2.6;
    this.hue = hue;
  }

  update(deltaTime) {
    this.x += this.vx * deltaTime;
    this.y += this.vy * deltaTime;
    this.rotation += this.spin * deltaTime;
  }

  draw(context) {
    context.save();
    context.translate(this.x, this.y);
    context.rotate(this.rotation);
    context.shadowBlur = 24;
    context.shadowColor = `hsla(${this.hue}, 100%, 70%, 0.7)`;
    context.fillStyle = `hsla(${this.hue}, 90%, 62%, 0.92)`;
    // Irregular crystal shapes make each incoming hazard feel a little less mechanical.
    context.beginPath();
    context.moveTo(0, -this.size);
    context.lineTo(this.size * 0.92, this.size * 0.15);
    context.lineTo(this.size * 0.28, this.size);
    context.lineTo(-this.size * 0.8, this.size * 0.5);
    context.lineTo(-this.size * 0.6, -this.size * 0.65);
    context.closePath();
    context.fill();
    context.restore();
  }

  isOutOfBounds(width, height) {
    const margin = this.size * 4;
    return this.x < -margin || this.x > width + margin || this.y < -margin || this.y > height + margin;
  }
}

class Core {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 11;
    this.pulse = Math.random() * Math.PI * 2;
  }

  update(deltaTime) {
    this.pulse += deltaTime * 3.6;
  }

  draw(context) {
    const scale = 1 + Math.sin(this.pulse) * 0.12;

    context.save();
    context.translate(this.x, this.y);
    context.scale(scale, scale);
    context.rotate(this.pulse * 0.25);
    context.shadowBlur = 22;
    context.shadowColor = "rgba(156, 140, 255, 0.7)";
    context.fillStyle = "rgba(156, 140, 255, 0.92)";
    context.beginPath();
    context.moveTo(0, -this.radius);
    context.lineTo(this.radius * 0.8, 0);
    context.lineTo(0, this.radius);
    context.lineTo(-this.radius * 0.8, 0);
    context.closePath();
    context.fill();
    context.restore();
  }
}

class Hunter {
  constructor(x, y, speed) {
    this.x = x;
    this.y = y;
    this.radius = 16;
    this.speed = speed;
    this.rotation = Math.random() * Math.PI * 2;
  }

  update(deltaTime, player) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const angle = Math.atan2(dy, dx);
    this.x += Math.cos(angle) * this.speed * deltaTime;
    this.y += Math.sin(angle) * this.speed * deltaTime;
    this.rotation = angle;
  }

  draw(context) {
    context.save();
    context.translate(this.x, this.y);
    context.rotate(this.rotation + Math.PI / 2);
    context.shadowBlur = 20;
    context.shadowColor = "rgba(255, 111, 145, 0.75)";
    context.fillStyle = "rgba(255, 111, 145, 0.92)";
    context.beginPath();
    context.moveTo(0, -this.radius);
    context.lineTo(this.radius * 0.75, this.radius * 0.9);
    context.lineTo(0, this.radius * 0.45);
    context.lineTo(-this.radius * 0.75, this.radius * 0.9);
    context.closePath();
    context.fill();
    context.restore();
  }
}

class PowerUp {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.radius = 13;
    this.rotation = Math.random() * Math.PI * 2;
  }

  update(deltaTime) {
    this.rotation += deltaTime * 2.4;
  }

  draw(context) {
    const color = this.type === "shield" ? "rgba(116, 242, 255, 0.95)" : "rgba(255, 197, 109, 0.95)";
    const glow = this.type === "shield" ? "rgba(116, 242, 255, 0.7)" : "rgba(255, 197, 109, 0.7)";

    context.save();
    context.translate(this.x, this.y);
    context.rotate(this.rotation);
    context.shadowBlur = 24;
    context.shadowColor = glow;
    context.strokeStyle = color;
    context.lineWidth = 4;
    context.beginPath();
    context.arc(0, 0, this.radius, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(-6, 0);
    context.lineTo(6, 0);
    if (this.type === "shield") {
      context.moveTo(0, -6);
      context.lineTo(0, 6);
    }
    context.stroke();
    context.restore();
  }
}

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() * 2 - 1) * 240;
    this.vy = (Math.random() * 2 - 1) * 240;
    this.life = 0.8 + Math.random() * 0.5;
    this.maxLife = this.life;
    this.size = 2 + Math.random() * 5;
    this.color = color;
  }

  update(deltaTime) {
    this.life -= deltaTime;
    this.x += this.vx * deltaTime;
    this.y += this.vy * deltaTime;
    this.vx *= 0.98;
    this.vy *= 0.98;
  }

  draw(context) {
    const alpha = Math.max(this.life / this.maxLife, 0);
    context.beginPath();
    context.fillStyle = this.color.replace("ALPHA", alpha.toFixed(3));
    context.arc(this.x, this.y, this.size * alpha, 0, Math.PI * 2);
    context.fill();
  }

  get dead() {
    return this.life <= 0;
  }
}

class Game {
  constructor(context, bounds) {
    this.context = context;
    this.bounds = bounds;
    this.input = new InputManager();
    this.sound = new SoundManager();
    this.player = new Player(bounds);
    this.bestScore = Number(localStorage.getItem("gravity-panic-best") || 0);
    this.lastTime = 0;
    this.animationFrame = null;

    this.backgroundOrbs = Array.from({ length: 10 }, () => ({
      x: Math.random(),
      y: Math.random(),
      radius: 60 + Math.random() * 140,
      speed: 0.1 + Math.random() * 0.25,
      hue: 170 + Math.random() * 80,
    }));

    this.resetState();
    this.updateHud();
  }

  resetState() {
    this.running = false;
    this.over = false;
    this.score = 0;
    this.difficulty = 1;
    this.gravityDirection = "down";
    this.gravityVector = { x: 0, y: 1 };
    this.gravityTimer = 0;
    this.nextGravityShift = this.randomGravityInterval();
    this.spawnTimer = 0;
    this.spawnInterval = 1.15;
    this.coreTimer = 0;
    this.nextCoreSpawn = 4.5;
    this.hunterTimer = 0;
    this.hunterSpawnInterval = 8;
    this.powerUpTimer = 0;
    this.nextPowerUpSpawn = 10;
    this.obstacles = [];
    this.cores = [];
    this.hunters = [];
    this.powerUps = [];
    this.particles = [];
    this.coreCount = 0;
    this.dashCharges = 2;
    this.focusActive = false;
    this.focusTimer = 0;
    this.focusCooldown = 0;
    this.shieldCharges = 0;
    this.level = 1;
    this.levelProgress = 0;
    this.objectiveTarget = 3;
    this.player.reset();
  }

  randomGravityInterval() {
    return 2.8 + Math.random() * 1.7;
  }

  resize(width, height) {
    this.bounds.width = width;
    this.bounds.height = height;
    this.player.bounds = this.bounds;
  }

  start() {
    this.resetState();
    this.running = true;
    this.sound.playStart();
    this.hideOverlay(startOverlay);
    this.hideOverlay(gameOverOverlay);
    this.lastTime = performance.now();
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = requestAnimationFrame((time) => this.loop(time));
  }

  endGame() {
    this.running = false;
    this.over = true;
    this.bestScore = Math.max(this.bestScore, this.score);
    localStorage.setItem("gravity-panic-best", this.bestScore.toFixed(1));
    finalScoreElement.textContent = `You survived ${this.score.toFixed(1)} seconds, reached level ${this.level}, and collected ${this.coreCount} cores.`;
    this.sound.playGameOver();
    this.showOverlay(gameOverOverlay);
    this.updateHud();
  }

  loop(timestamp) {
    const deltaTime = Math.min((timestamp - this.lastTime) / 1000, 0.033);
    this.lastTime = timestamp;

    if (this.running) {
      this.update(deltaTime);
    }

    this.draw();
    this.animationFrame = requestAnimationFrame((time) => this.loop(time));
  }

  update(deltaTime) {
    const timeScale = this.focusActive ? 0.45 : 1;
    const scaledDelta = deltaTime * timeScale;

    // Difficulty ramps by shortening spawn windows and strengthening motion.
    this.score += deltaTime;
    this.difficulty = 1 + this.score * 0.18;
    this.spawnInterval = Math.max(0.28, 1.05 - this.score * 0.022);
    this.hunterSpawnInterval = Math.max(3.4, 8 - this.level * 0.45);
    this.focusCooldown = Math.max(0, this.focusCooldown - deltaTime);

    if (this.focusActive) {
      this.focusTimer -= deltaTime;
      if (this.focusTimer <= 0) {
        this.focusActive = false;
      }
    }

    this.handleManualAbilities();

    this.gravityTimer += scaledDelta;
    if (this.gravityTimer >= this.nextGravityShift) {
      this.shiftGravity();
    }

    this.spawnTimer += scaledDelta;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0;
      this.spawnObstacle();
    }

    this.coreTimer += deltaTime;
    if (this.coreTimer >= this.nextCoreSpawn && this.cores.length < 2) {
      this.coreTimer = 0;
      this.nextCoreSpawn = 5 + Math.random() * 3;
      this.spawnCore();
    }

    this.hunterTimer += scaledDelta;
    if (this.hunterTimer >= this.hunterSpawnInterval && this.hunters.length < Math.min(2 + this.level, 6)) {
      this.hunterTimer = 0;
      this.spawnHunter();
    }

    this.powerUpTimer += deltaTime;
    if (this.powerUpTimer >= this.nextPowerUpSpawn && this.powerUps.length === 0) {
      this.powerUpTimer = 0;
      this.nextPowerUpSpawn = 11 + Math.random() * 5;
      this.spawnPowerUp();
    }

    this.player.update(deltaTime, this.gravityVector, this.input, this.difficulty);

    for (const obstacle of this.obstacles) {
      obstacle.update(scaledDelta);
    }

    for (const core of this.cores) {
      core.update(deltaTime);
    }

    for (const hunter of this.hunters) {
      hunter.update(scaledDelta, this.player);
    }

    for (const powerUp of this.powerUps) {
      powerUp.update(deltaTime);
    }

    for (const particle of this.particles) {
      particle.update(deltaTime);
    }

    this.obstacles = this.obstacles.filter((obstacle) => !obstacle.isOutOfBounds(this.bounds.width, this.bounds.height));
    this.particles = this.particles.filter((particle) => !particle.dead);
    this.collectCores();
    this.collectPowerUps();

    if (this.checkCollisions()) {
      this.handleHit();
    }

    this.updateHud();
  }

  handleManualAbilities() {
    if (this.input.consumePress("shift")) {
      this.tryDash();
    }

    if (this.input.consumePress(" ")) {
      this.tryFocus();
    }
  }

  shiftGravity() {
    // Gravity never repeats immediately, so each shift forces a new reaction.
    const current = this.gravityDirection;
    const choices = DIRECTIONS.filter((direction) => direction !== current);
    this.gravityDirection = choices[Math.floor(Math.random() * choices.length)];
    this.gravityVector = this.directionToVector(this.gravityDirection);
    this.gravityTimer = 0;
    this.nextGravityShift = this.randomGravityInterval();
    this.createBurst(this.player.x, this.player.y, "rgba(116, 242, 255, ALPHA)");
    this.sound.playGravityShift();
  }

  directionToVector(direction) {
    switch (direction) {
      case "up":
        return { x: 0, y: -1 };
      case "left":
        return { x: -1, y: 0 };
      case "right":
        return { x: 1, y: 0 };
      default:
        return { x: 0, y: 1 };
    }
  }

  spawnObstacle() {
    // Hazards can invade from any edge, independent of the active gravity.
    const direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    const speed = 180 + this.difficulty * 42 + Math.random() * 90;
    const size = 12 + Math.random() * 16;
    const hue = 18 + Math.random() * 60;

    let x;
    let y;
    let vx;
    let vy;

    if (direction === "down") {
      x = Math.random() * this.bounds.width;
      y = -size * 2;
      vx = (Math.random() * 2 - 1) * 40;
      vy = speed;
    } else if (direction === "up") {
      x = Math.random() * this.bounds.width;
      y = this.bounds.height + size * 2;
      vx = (Math.random() * 2 - 1) * 40;
      vy = -speed;
    } else if (direction === "left") {
      x = this.bounds.width + size * 2;
      y = Math.random() * this.bounds.height;
      vx = -speed;
      vy = (Math.random() * 2 - 1) * 40;
    } else {
      x = -size * 2;
      y = Math.random() * this.bounds.height;
      vx = speed;
      vy = (Math.random() * 2 - 1) * 40;
    }

    this.obstacles.push(new Obstacle(x, y, size, vx, vy, hue));
  }

  spawnCore() {
    const margin = 60;
    const x = margin + Math.random() * (this.bounds.width - margin * 2);
    const y = margin + Math.random() * (this.bounds.height - margin * 2);
    this.cores.push(new Core(x, y));
  }

  spawnHunter() {
    const side = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    const margin = 36;
    let x = this.bounds.width / 2;
    let y = this.bounds.height / 2;

    if (side === "down") {
      x = Math.random() * this.bounds.width;
      y = -margin;
    } else if (side === "up") {
      x = Math.random() * this.bounds.width;
      y = this.bounds.height + margin;
    } else if (side === "left") {
      x = this.bounds.width + margin;
      y = Math.random() * this.bounds.height;
    } else {
      x = -margin;
      y = Math.random() * this.bounds.height;
    }

    const speed = 115 + this.level * 12 + Math.random() * 20;
    this.hunters.push(new Hunter(x, y, speed));
  }

  spawnPowerUp() {
    const margin = 70;
    const x = margin + Math.random() * (this.bounds.width - margin * 2);
    const y = margin + Math.random() * (this.bounds.height - margin * 2);
    const type = Math.random() > 0.45 ? "shield" : "overdrive";
    this.powerUps.push(new PowerUp(x, y, type));
  }

  collectCores() {
    this.cores = this.cores.filter((core) => {
      const dx = core.x - this.player.x;
      const dy = core.y - this.player.y;
      const distance = Math.hypot(dx, dy);

      if (distance < core.radius + this.player.radius) {
        this.coreCount += 1;
        this.levelProgress += 1;
        this.dashCharges = Math.min(3, this.dashCharges + 1);
        this.createBurst(core.x, core.y, "rgba(156, 140, 255, ALPHA)");
        this.sound.playCorePickup();
        this.checkLevelObjective();
        return false;
      }

      return true;
    });
  }

  collectPowerUps() {
    this.powerUps = this.powerUps.filter((powerUp) => {
      const dx = powerUp.x - this.player.x;
      const dy = powerUp.y - this.player.y;
      const distance = Math.hypot(dx, dy);

      if (distance < powerUp.radius + this.player.radius) {
        if (powerUp.type === "shield") {
          this.shieldCharges = Math.min(2, this.shieldCharges + 1);
        } else {
          this.dashCharges = Math.min(3, this.dashCharges + 2);
          this.focusCooldown = Math.max(0, this.focusCooldown - 1.2);
        }

        this.createBurst(powerUp.x, powerUp.y, powerUp.type === "shield" ? "rgba(116, 242, 255, ALPHA)" : "rgba(255, 197, 109, ALPHA)");
        this.sound.playPowerUp();
        return false;
      }

      return true;
    });
  }

  checkLevelObjective() {
    if (this.levelProgress < this.objectiveTarget) {
      return;
    }

    this.level += 1;
    this.levelProgress = 0;
    this.objectiveTarget = 2 + this.level;
    this.dashCharges = Math.min(3, this.dashCharges + 1);
    this.shieldCharges = Math.min(2, this.shieldCharges + 1);
    this.obstacles = [];
    this.hunters = [];
    this.createBurst(this.player.x, this.player.y, "rgba(152, 255, 203, ALPHA)");
    this.sound.playLevelUp();
  }

  tryDash() {
    if (this.dashCharges <= 0) {
      return;
    }

    let directionX = 0;
    let directionY = 0;

    if (this.input.isPressed("arrowleft", "a")) {
      directionX -= 1;
    }
    if (this.input.isPressed("arrowright", "d")) {
      directionX += 1;
    }
    if (this.input.isPressed("arrowup", "w")) {
      directionY -= 1;
    }
    if (this.input.isPressed("arrowdown", "s")) {
      directionY += 1;
    }

    if (directionX === 0 && directionY === 0) {
      directionX = -this.gravityVector.x;
      directionY = -this.gravityVector.y;
    }

    this.dashCharges -= 1;
    this.player.dash(directionX, directionY);
    this.createBurst(this.player.x, this.player.y, "rgba(255, 197, 109, ALPHA)");
    this.sound.playDash();
  }

  tryFocus() {
    if (this.coreCount < 3 || this.focusActive || this.focusCooldown > 0) {
      return;
    }

    this.coreCount -= 3;
    this.focusActive = true;
    this.focusTimer = 1.8;
    this.focusCooldown = 4;
    this.createBurst(this.player.x, this.player.y, "rgba(116, 242, 255, ALPHA)");
    this.sound.playFocus();
  }

  checkCollisions() {
    const hitObstacle = this.obstacles.some((obstacle) => {
      const dx = obstacle.x - this.player.x;
      const dy = obstacle.y - this.player.y;
      const distance = Math.hypot(dx, dy);
      return distance < obstacle.size + this.player.radius * 0.92;
    });

    const hitHunter = this.hunters.some((hunter) => {
      const dx = hunter.x - this.player.x;
      const dy = hunter.y - this.player.y;
      const distance = Math.hypot(dx, dy);
      return distance < hunter.radius + this.player.radius * 0.9;
    });

    return hitObstacle || hitHunter;
  }

  handleHit() {
    if (this.shieldCharges > 0) {
      this.shieldCharges -= 1;
      this.obstacles = this.obstacles.filter((obstacle) => {
        const dx = obstacle.x - this.player.x;
        const dy = obstacle.y - this.player.y;
        return Math.hypot(dx, dy) > obstacle.size + this.player.radius + 40;
      });
      this.hunters = this.hunters.filter((hunter) => {
        const dx = hunter.x - this.player.x;
        const dy = hunter.y - this.player.y;
        return Math.hypot(dx, dy) > hunter.radius + this.player.radius + 50;
      });
      this.createBurst(this.player.x, this.player.y, "rgba(116, 242, 255, ALPHA)");
      this.sound.playShieldBreak();
      return;
    }

    this.createBurst(this.player.x, this.player.y, "rgba(255, 111, 145, ALPHA)");
    this.endGame();
  }

  createBurst(x, y, color) {
    for (let i = 0; i < 14; i += 1) {
      this.particles.push(new Particle(x, y, color));
    }
  }

  drawBackground() {
    this.context.clearRect(0, 0, this.bounds.width, this.bounds.height);

    const gradient = this.context.createLinearGradient(0, 0, this.bounds.width, this.bounds.height);
    gradient.addColorStop(0, "#071123");
    gradient.addColorStop(1, "#03070f");
    this.context.fillStyle = gradient;
    this.context.fillRect(0, 0, this.bounds.width, this.bounds.height);

    // Slow-moving energy blooms keep the arena lively even between danger spikes.
    for (const orb of this.backgroundOrbs) {
      const x = orb.x * this.bounds.width + Math.sin(this.score * orb.speed + orb.radius) * 40;
      const y = orb.y * this.bounds.height + Math.cos(this.score * orb.speed) * 32;
      const glow = this.context.createRadialGradient(x, y, 0, x, y, orb.radius);
      glow.addColorStop(0, `hsla(${orb.hue}, 100%, 70%, 0.14)`);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      this.context.fillStyle = glow;
      this.context.beginPath();
      this.context.arc(x, y, orb.radius, 0, Math.PI * 2);
      this.context.fill();
    }

    this.context.strokeStyle = "rgba(116, 242, 255, 0.08)";
    this.context.lineWidth = 1;
    for (let x = 0; x < this.bounds.width; x += 60) {
      this.context.beginPath();
      this.context.moveTo(x, 0);
      this.context.lineTo(x, this.bounds.height);
      this.context.stroke();
    }
    for (let y = 0; y < this.bounds.height; y += 60) {
      this.context.beginPath();
      this.context.moveTo(0, y);
      this.context.lineTo(this.bounds.width, y);
      this.context.stroke();
    }
  }

  drawGravityIndicator() {
    const centerX = this.bounds.width - 78;
    const centerY = 72;
    const direction = this.gravityVector;
    const pulse = 1 + Math.sin(this.score * 4.5) * 0.08;

    this.context.save();
    this.context.translate(centerX, centerY);

    this.context.beginPath();
    this.context.fillStyle = "rgba(8, 18, 36, 0.75)";
    this.context.arc(0, 0, 34, 0, Math.PI * 2);
    this.context.fill();

    this.context.strokeStyle = "rgba(116, 242, 255, 0.3)";
    this.context.lineWidth = 2;
    this.context.stroke();

    this.context.rotate(Math.atan2(direction.y, direction.x) + Math.PI / 2);
    this.context.scale(pulse, pulse);
    this.context.beginPath();
    this.context.moveTo(0, -19);
    this.context.lineTo(12, 10);
    this.context.lineTo(4, 10);
    this.context.lineTo(4, 19);
    this.context.lineTo(-4, 19);
    this.context.lineTo(-4, 10);
    this.context.lineTo(-12, 10);
    this.context.closePath();
    this.context.fillStyle = "rgba(152, 255, 203, 0.95)";
    this.context.shadowBlur = 18;
    this.context.shadowColor = "rgba(152, 255, 203, 0.85)";
    this.context.fill();

    this.context.restore();
  }

  drawDifficultyBar() {
    const width = 170;
    const height = 12;
    const x = 24;
    const y = 24;
    const fillWidth = Math.min(width, (this.difficulty / 12) * width);

    this.context.fillStyle = "rgba(255, 255, 255, 0.08)";
    this.context.fillRect(x, y, width, height);

    const gradient = this.context.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, "#74f2ff");
    gradient.addColorStop(1, "#ff6f91");
    this.context.fillStyle = gradient;
    this.context.fillRect(x, y, fillWidth, height);

    this.context.font = "12px Space Grotesk";
    this.context.fillStyle = "rgba(244, 247, 255, 0.8)";
    this.context.fillText("Chaos", x, y - 8);
  }

  draw() {
    this.drawBackground();
    this.drawDifficultyBar();
    this.drawGravityIndicator();

    for (const core of this.cores) {
      core.draw(this.context);
    }

    for (const powerUp of this.powerUps) {
      powerUp.draw(this.context);
    }

    for (const obstacle of this.obstacles) {
      obstacle.draw(this.context);
    }

    for (const hunter of this.hunters) {
      hunter.draw(this.context);
    }

    for (const particle of this.particles) {
      particle.draw(this.context);
    }

    this.player.draw(this.context);

    if (this.shieldCharges > 0) {
      const shieldAlpha = 0.28 + Math.sin(this.player.shieldPulse) * 0.08;
      this.context.beginPath();
      this.context.strokeStyle = `rgba(116, 242, 255, ${shieldAlpha})`;
      this.context.lineWidth = 4;
      this.context.arc(this.player.x, this.player.y, this.player.radius + 10, 0, Math.PI * 2);
      this.context.stroke();
    }
  }

  updateHud() {
    scoreElement.textContent = `${this.score.toFixed(1)}s`;
    bestScoreElement.textContent = `${this.bestScore.toFixed(1)}s`;
    gravityLabelElement.textContent = DIRECTION_LABELS[this.gravityDirection];
    coreCountElement.textContent = `${this.coreCount} | Dash ${this.dashCharges} | Shield ${this.shieldCharges}`;
    coreCountElement.classList.toggle("ready", this.coreCount >= 3 || this.dashCharges > 0);
    levelLabelElement.textContent = `${this.level}`;
    objectiveLabelElement.textContent = `Collect ${this.objectiveTarget - this.levelProgress} more cores`;
  }

  showOverlay(element) {
    element.classList.add("overlay--visible");
  }

  hideOverlay(element) {
    element.classList.remove("overlay--visible");
  }
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  game.resize(rect.width, rect.height);
  game.draw();
}

const game = new Game(ctx, {
  width: canvas.clientWidth || 900,
  height: canvas.clientHeight || 600,
});

startButton.addEventListener("click", () => game.start());
restartButton.addEventListener("click", () => game.start());
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
