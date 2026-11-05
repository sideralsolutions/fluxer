// SPDX-License-Identifier: AGPL-3.0-or-later

export const R = 0.22;
export const MAX_SPEED = 17;
export const STEP = 1 / 120;
const FRICTION = {grass: 0.75, ice: 0.32, sand: 1.9, belt: 0.75, boost: 0, jump: 0.75, hazard: 0.75};
const BALL_SPACING = 0.75;
const WALL_HIT_SPEED = 2.5;
const SOUND_GAP = 0.09;

// A física de uma pista. Roda só no servidor: o cliente recebe as posições e desenha.
export class GolfWorld {
	constructor(course, count, {penalties = true} = {}) {
		this.course = course;
		this.penalties = penalties;
		this.time = 0;
		this.events = [];
		this.solids = course.walls.map((wall) => ({
			x: wall.x, z: wall.z, hx: wall.hx, hz: wall.hz,
			y: wall.y + wall.height / 2 - 0.2, hy: (wall.height + 0.4) / 2 + wall.rise,
			a: 0, w: 0, e: 0.55, wall: true,
		}));
		for (const s of course.spinners) {
			for (const offset of s.cross ? [0, Math.PI / 2] : [0]) {
				this.solids.push({x: s.x, y: s.y, z: s.z, hx: s.len, hy: 0.24, hz: 0.21, a: 0, w: s.w, offset, e: 0.7});
			}
		}
		for (const slide of course.sliders) {
			this.solids.push({x: slide.x, x0: slide.x, z0: slide.z, y: slide.y, z: slide.z, hx: slide.hx, hy: 0.35, hz: slide.hz, a: 0, w: 0, e: 0.8, slide});
		}
		course.holeY = this.groundAt(course.hole[0], course.hole[1], 60).h;
		this.balls = Array.from({length: count}, (_, i) => {
			const x = course.start[0] + (i - (count - 1) / 2) * BALL_SPACING;
			const z = course.start[1];
			const y = this.groundAt(x, z, 60).h + R;
			return {i, x, y, z, vx: 0, vy: 0, vz: 0, rest: true, last: [x, y, z], strokes: 0, done: false, out: false, moving: 0, tele: 0, sounded: 0, finishedAt: null};
		});
	}

	emit(kind, ball, strength = 1) {
		if (kind !== 'hit' && this.time - ball.sounded < SOUND_GAP) return;
		ball.sounded = this.time;
		this.events.push([kind, ball.i, Math.round(strength * 100) / 100]);
	}

	groundAt(x, z, y) {
		let best = null;
		let height = -Infinity;
		for (const p of this.course.pads) {
			const dx = x - p.x;
			const dz = z - p.z;
			if (Math.abs(dx) > p.w / 2 || Math.abs(dz) > p.d / 2) continue;
			const h = p.y + p.sx * dx + p.sz * dz;
			if (h <= y - R + 0.45 && h > height) {
				height = h;
				best = p;
			}
		}
		return {p: best, h: height};
	}

	hitBox(b, s) {
		if (b.y < s.y - s.hy - R || b.y > s.y + s.hy + R) return;
		const a = s.a + (s.offset ?? 0);
		const c = Math.cos(a);
		const n = Math.sin(a);
		const rx = b.x - s.x;
		const rz = b.z - s.z;
		const lx = rx * c + rz * n;
		const lz = -rx * n + rz * c;
		const ly = b.y - s.y;
		let dx = lx - Math.max(-s.hx, Math.min(s.hx, lx));
		let dy = ly - Math.max(-s.hy, Math.min(s.hy, ly));
		let dz = lz - Math.max(-s.hz, Math.min(s.hz, lz));
		let d = Math.hypot(dx, dy, dz);
		if (d >= R) return;
		if (d < 1e-6) {
			const px = s.hx - Math.abs(lx);
			const pz = s.hz - Math.abs(lz);
			if (px < pz) {
				dx = Math.sign(lx) || 1;
				dz = 0;
			} else {
				dz = Math.sign(lz) || 1;
				dx = 0;
			}
			dy = 0;
			d = 1;
			b.x += (dx * c - dz * n) * (Math.min(px, pz) + R);
			b.z += (dx * n + dz * c) * (Math.min(px, pz) + R);
		}
		const nx = (dx * c - dz * n) / d;
		const nz = (dx * n + dz * c) / d;
		const ny = dy / d;
		const pen = R - Math.min(d, R);
		b.x += nx * pen;
		b.y += ny * pen;
		b.z += nz * pen;
		const sx = (s.vx ?? 0) - s.w * rz;
		const sz = (s.vz ?? 0) + s.w * rx;
		const vn = (b.vx - sx) * nx + b.vy * ny + (b.vz - sz) * nz;
		if (vn >= 0) return;
		const k = (1 + s.e) * vn;
		b.vx -= k * nx;
		b.vy -= k * ny;
		b.vz -= k * nz;
		b.rest = false;
		if (-vn > WALL_HIT_SPEED) this.emit(s.wall ? 'wall' : 'obstacle', b, Math.min(1, -vn / MAX_SPEED));
	}

	hitBumper(b, u) {
		if (Math.abs(b.y - u.y - 0.35) > 0.35 + R) return;
		const dx = b.x - u.x;
		const dz = b.z - u.z;
		const d = Math.hypot(dx, dz);
		if (d >= 0.55 + R || d === 0) return;
		const nx = dx / d;
		const nz = dz / d;
		b.x = u.x + nx * (0.55 + R);
		b.z = u.z + nz * (0.55 + R);
		const vn = b.vx * nx + b.vz * nz;
		b.vx += (-1.6 * Math.min(vn, 0) + 5) * nx;
		b.vz += (-1.6 * Math.min(vn, 0) + 5) * nz;
		b.rest = false;
		this.emit('bumper', b);
	}

	respawn(b, kind) {
		[b.x, b.y, b.z] = b.last;
		b.vx = b.vy = b.vz = 0;
		b.rest = true;
		if (this.penalties) b.strokes += 1;
		this.emit(kind, b);
	}

	sink(b) {
		b.done = true;
		b.rest = true;
		b.finishedAt = this.time;
		b.x = this.course.hole[0];
		b.z = this.course.hole[1];
		b.vx = b.vy = b.vz = 0;
		this.emit('sink', b);
	}

	moveBall(b, dt) {
		const {course} = this;
		b.tele = Math.max(0, b.tele - dt);
		for (const s of this.solids) this.hitBox(b, s);
		for (const u of course.bumpers) this.hitBumper(b, u);
		if (b.rest) return;
		b.moving += dt;
		b.vy -= course.g * dt;
		b.x += b.vx * dt;
		b.y += b.vy * dt;
		b.z += b.vz * dt;
		const {p, h} = this.groundAt(b.x, b.z, b.y);
		if (p && b.y - R <= h) {
			b.y = h + R;
			const len = Math.hypot(p.sx, 1, p.sz);
			const nx = -p.sx / len;
			const ny = 1 / len;
			const nz = -p.sz / len;
			const vn = b.vx * nx + b.vy * ny + b.vz * nz;
			if (vn < 0) {
				const k = vn < -2.2 ? 1.35 : 1;
				b.vx -= k * vn * nx;
				b.vy -= k * vn * ny;
				b.vz -= k * vn * nz;
				if (vn < -3) this.emit('land', b, Math.min(1, -vn / 12));
			}
			if (p.kind === 'hazard') {
				this.respawn(b, 'hazard');
				return;
			}
			if (p.kind === 'jump') {
				b.vy = p.j;
				this.emit('jump', b);
			}
			if (p.kind === 'boost') {
				b.vx += p.dir[0] * 34 * dt;
				b.vz += p.dir[1] * 34 * dt;
				if (b.moving - (b.boosted ?? -1) > 0.6) this.emit('boost', b);
				b.boosted = b.moving;
			}
			const damp = Math.exp(-FRICTION[p.kind] * dt);
			b.vx *= damp;
			b.vz *= damp;
			if (p.kind === 'belt') {
				b.vx += p.belt[0] * 1.4 * dt;
				b.vz += p.belt[1] * 1.4 * dt;
			}
			const speed = Math.hypot(b.vx, b.vz);
			const dh = Math.hypot(b.x - course.hole[0], b.z - course.hole[1]);
			if (Math.abs(h - course.holeY) < 0.3 && dh < 1 && speed < 6) {
				b.vx += ((course.hole[0] - b.x) / dh) * 7 * dt;
				b.vz += ((course.hole[1] - b.z) / dh) * 7 * dt;
				if (dh < 0.34 && speed < 6.5) {
					this.sink(b);
					return;
				}
			}
			const flat = p.sx === 0 && p.sz === 0 && p.kind !== 'belt' && p.kind !== 'boost' && p.kind !== 'jump';
			if (flat && ((speed < 0.16 && Math.abs(b.vy) < 0.6) || b.moving > 14)) {
				b.vx = b.vy = b.vz = 0;
				b.rest = true;
				b.moving = 0;
				b.boosted = undefined;
				b.last = [b.x, b.y, b.z];
			}
		}
		for (const t of course.teleports) {
			if (b.tele === 0 && Math.hypot(b.x - t.from[0], b.z - t.from[2]) < 0.6 && Math.abs(b.y - t.from[1]) < 1) {
				[b.x, , b.z] = t.to;
				b.y = t.to[1] + R + 0.05;
				b.tele = 1;
				const speed = Math.hypot(b.vx, b.vz);
				b.vx = 0;
				b.vz = Math.min(speed, 4);
				this.emit('portal', b);
			}
		}
		if (b.y < course.minY - 8) this.respawn(b, 'fall');
	}

	bumpBalls() {
		const {balls} = this;
		for (let i = 0; i < balls.length; i++) {
			for (let j = i + 1; j < balls.length; j++) {
				const a = balls[i];
				const b = balls[j];
				if (a.done || b.done || a.out || b.out) continue;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dz = b.z - a.z;
				const d = Math.hypot(dx, dy, dz);
				if (d >= 2 * R || d === 0) continue;
				const nx = dx / d;
				const ny = dy / d;
				const nz = dz / d;
				const pen = (2 * R - d) / 2;
				a.x -= nx * pen;
				a.z -= nz * pen;
				b.x += nx * pen;
				b.z += nz * pen;
				const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz;
				if (vn <= 0) continue;
				const k = 0.95 * vn;
				a.vx -= k * nx;
				a.vz -= k * nz;
				b.vx += k * nx;
				b.vz += k * nz;
				a.rest = b.rest = false;
				if (vn > 1) this.emit('ball', a, Math.min(1, vn / MAX_SPEED));
			}
		}
	}

	shoot(ball, x, z, power) {
		const speed = Math.max(0, Math.min(1, power)) * MAX_SPEED;
		ball.vx = x * speed;
		ball.vz = z * speed;
		ball.vy = 0;
		ball.rest = false;
		ball.moving = 0;
		ball.strokes += 1;
		this.emit('hit', ball, power);
	}

	step(dt) {
		this.time += dt;
		for (const s of this.solids) {
			if (s.w) s.a = s.w * this.time;
			if (s.slide) {
				const {amp, speed, ax, az} = s.slide;
				const at = amp * Math.sin(speed * this.time);
				const rate = amp * speed * Math.cos(speed * this.time);
				s.x = s.x0 + ax * at;
				s.z = s.z0 + az * at;
				s.vx = ax * rate;
				s.vz = az * rate;
			}
		}
		for (const b of this.balls) if (!b.done && !b.out) this.moveBall(b, dt);
		this.bumpBalls();
	}

	get moving() {
		return this.balls.some((b) => !b.rest);
	}
}

const WAY_LOOKAHEAD = 6;
const WAY_NEAR = 4.5;
const WAY_HEIGHT = 2.4;

// Próximo ponto da rota. Mira no fim do trecho atual para não tacar de metro em metro.
export function nextTarget(world, bot, ball) {
	const {way, hole} = world.course;
	for (let i = Math.min(way.length - 1, bot.wp + WAY_LOOKAHEAD); i >= bot.wp; i--) {
		const near = way[i].near ?? WAY_NEAR;
		if (Math.hypot(ball.x - way[i].x, ball.z - way[i].z) < near && Math.abs(ball.y - way[i].y) < WAY_HEIGHT) {
			bot.wp = i + 1;
			break;
		}
	}
	let i = bot.wp;
	while (way[i + 1] && way[i + 1].seg === way[i]?.seg) i += 1;
	return way[i] ?? {x: hole[0], z: hole[1]};
}

export function botShot(world, bot, ball, random) {
	const target = nextTarget(world, bot, ball);
	const dx = target.x - ball.x;
	const dz = target.z - ball.z;
	const under = FRICTION[world.groundAt(ball.x, ball.z, ball.y).p?.kind ?? 'grass'];
	const speed = target.p ?? Math.max(1.6, Math.min(16, Math.hypot(dx, dz) * under + 1.1));
	const angle = Math.atan2(dx, dz) + (random() - 0.5) * 0.09;
	return {x: Math.sin(angle), z: Math.cos(angle), power: (speed * (0.94 + random() * 0.12)) / MAX_SPEED};
}
