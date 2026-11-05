// SPDX-License-Identifier: AGPL-3.0-or-later

const WALL_THICKNESS = 0.15;
const WALL_HEIGHT = 0.55;

// Parede de um lado da pista: o servidor colide com a caixa e o cliente desenha a mesma caixa.
function wallBox(p, side) {
	const T = WALL_THICKNESS;
	const ns = side === 'n' || side === 's';
	const sign = side === 'n' || side === 'e' ? 1 : -1;
	return {
		x: ns ? p.x : p.x + sign * (p.w / 2 + T),
		z: ns ? p.z + sign * (p.d / 2 + T) : p.z,
		hx: ns ? p.w / 2 + 2 * T : T,
		hz: ns ? T : p.d / 2 + 2 * T,
		y: p.y,
		height: WALL_HEIGHT,
		edge: ns ? (sign * p.d / 2) * p.sz : 0,
		sx: p.sx,
		sz: p.sz,
		rise: Math.abs(p.sz) * p.d / 2 + Math.abs(p.sx) * p.w / 2,
	};
}

const pad = (x, z, w, d, y, o = {}) => ({x, z, w, d, y, sx: 0, sz: 0, kind: 'grass', walls: '', ...o});
const S = (len, o = {}) => ({t: 'straight', len, ...o});
const T = (side) => ({t: 'turn', side});
const UP = (len, rise, o = {}) => ({t: 'straight', len, rise, ...o});
const DOWN = (len, drop, o = {}) => ({t: 'straight', len, rise: -drop, ...o});
const JUMP = (gap, drop = 0) => ({t: 'jump', gap, drop});
const BOUNCE = (rise) => ({t: 'bounce', rise});
const PORTAL = (x, z, y = 0) => ({t: 'portal', x, z, y});
const HOLE = (len = 14) => ({t: 'hole', len});
const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const sideName = ([x, z]) => (z > 0 ? 'n' : z < 0 ? 's' : x > 0 ? 'e' : 'w');

// Cada pista é uma lista de trechos seguidos por um cursor, que também anota o caminho dos bots.
function buildCourse(theme, sections) {
	const c = {...theme, pads: [], spinners: [], sliders: [], bumpers: [], teleports: [], way: [], yaw: 0};
	const W = theme.width ?? 7;
	let x = 0, z = 0, y = 0, dir = 0, first = true;
	let seg = 0;
	const mark = (px, pz, py, near, p) => c.way.push({x: px, z: pz, y: py, near, seg, p});
	const span = (len, rise, o) => {
		const [dx, dz] = DIRS[dir];
		const walls = [sideName(DIRS[(dir + 1) % 4]), sideName(DIRS[(dir + 3) % 4])];
		if (first) walls.push(sideName(DIRS[(dir + 2) % 4]));
		if (o.cap) walls.push(sideName(DIRS[dir]));
		first = false;
		c.pads.push(pad(x + dx * len / 2, z + dz * len / 2, dz ? W : len, dz ? len : W, y + rise / 2, {
			sx: dx * rise / len, sz: dz * rise / len, walls: o.open ? '' : walls.join(''), kind: o.kind ?? 'grass', dir: [dx, dz], belt: [-dx * 3.2, -dz * 3.2],
		}));
	};
	const along = (len, at) => { const [dx, dz] = DIRS[dir]; return [x + dx * len * at, z + dz * len * at]; };
	const across = (px, pz, amount) => { const [dx, dz] = DIRS[dir]; return [px + dz * amount, pz - dx * amount]; };
	const straight = ({len, rise = 0, ...o}) => {
		span(len, rise, o);
		const [dx, dz] = DIRS[dir];
		const yAt = (at) => y + rise * at;
		for (let i = 1; i <= (o.spin ?? 0); i++) {
			const [px, pz] = along(len, i / ((o.spin ?? 0) + 1));
			c.spinners.push({x: px, y: yAt(i / (o.spin + 1)) + 0.32, z: pz, len: W * 0.36, w: i % 2 ? 1.5 : -1.8, cross: Boolean(o.cross)});
		}
		for (let i = 1; i <= (o.bump ?? 0); i++) {
			const [px, pz] = along(len, i / (o.bump + 1));
			const [bx, bz] = across(px, pz, (i % 2 ? 1 : -1) * W / 4);
			c.bumpers.push({x: bx, z: bz, y: yAt(i / (o.bump + 1))});
		}
		for (let i = 1; i <= (o.slide ?? 0); i++) {
			const [px, pz] = along(len, i / (o.slide + 1));
			c.sliders.push({x: px, y: yAt(i / (o.slide + 1)) + 0.38, z: pz, hx: dz ? 1 : 0.28, hz: dz ? 0.28 : 1, ax: dz ? 1 : 0, az: dz ? 0 : 1, amp: W / 2 - 1.1, speed: (i % 2 ? 1.6 : -2) + i * 0.1});
		}
		for (let i = 1; i <= (o.hazard ?? 0); i++) {
			const [px, pz] = along(len, i / (o.hazard + 1));
			const hw = W / 2 - 1.6;
			const [hx, hz] = across(px, pz, (i % 2 ? 1 : -1) * (W / 2 - hw / 2));
			c.pads.push(pad(hx, hz, dz ? hw : 3.2, dz ? 3.2 : hw, y + rise * (i / (o.hazard + 1)) + 0.03, {kind: 'hazard'}));
		}
		const steps = Math.ceil(len / 6);
		const force = o.kind === 'belt' ? 16.5 : rise > 0 ? Math.min(16.5, 10 + rise * 2) : undefined;
		for (let i = 1; i <= steps; i++) { const [px, pz] = along(len, i / steps); mark(px, pz, yAt(i / steps), undefined, force); }
		x += dx * len; z += dz * len; y += rise;
	};
	for (const section of sections) {
		seg += 1;
		const [dx, dz] = DIRS[dir];
		if (section.t === 'straight') straight(section);
		if (section.t === 'turn') {
			const next = (dir + (section.side === 'l' ? 1 : 3)) % 4;
			const cx = x + dx * W / 2, cz = z + dz * W / 2;
			const walls = sideName(DIRS[dir]) + sideName(DIRS[(next + 2) % 4]);
			c.pads.push(pad(cx, cz, W, W, y, {walls}));
			mark(cx, cz, y);
			dir = next;
			x = cx + DIRS[dir][0] * W / 2; z = cz + DIRS[dir][1] * W / 2;
		}
		if (section.t === 'jump') {
			c.pads.push(pad(x + dx * 1.6, z + dz * 1.6, dz ? W : 3.2, dz ? 3.2 : W, y + 0.02, {kind: 'boost', dir: [dx, dz], walls: dz ? 'we' : 'ns'}));
			mark(x + dx * 1.6, z + dz * 1.6, y, 1.5);
			x += dx * 3.2; z += dz * 3.2;
			straight({len: 4.5, rise: 1.3});
			c.way.pop();
			x += dx * section.gap; z += dz * section.gap;
			y -= section.drop;
		}
		if (section.t === 'bounce') {
			c.way.at(-1).p = 12;
			c.pads.push(pad(x + dx * 1.2, z + dz * 1.2, dz ? W : 2.4, dz ? 2.4 : W, y + 0.02, {kind: 'jump', j: Math.sqrt(2 * theme.g * (section.rise + 1.1)), dir: [dx, dz], walls: dz ? 'we' : 'ns'}));
			mark(x + dx * 1.2, z + dz * 1.2, y, 1.5, 10);
			x += dx * 4.4; z += dz * 4.4;
			y += section.rise;
		}
		if (section.t === 'portal') {
			const [px, pz] = along(0, 0);
			c.teleports.push({from: [px, y, pz], to: [px + section.x, y + section.y, pz + section.z]});
			mark(px, pz, y, 1);
			x = px + section.x; z = pz + section.z; y += section.y;
			first = true;
			x -= dx * 2; z -= dz * 2;
			mark(x + dx * 5, z + dz * 5, y);
		}
		if (section.t === 'hole') {
			span(section.len, 0, {cap: true});
			const [hx, hz] = along(section.len, 0.62);
			c.hole = [hx, hz];
		}
	}
	c.start = [0, 2.5];
	c.minY = Math.min(...c.pads.map((p) => p.y));
	c.walls = c.pads.flatMap((p) => [...p.walls].map((side) => wallBox(p, side)));
	return c;
}

export const COURSES = [
	buildCourse({name: 'Churrasco na laje', sky: 0xf08a5d, fog: 0xf4b183, g: 14, a: '#3c9e4d', b: '#44ad57', pattern: 'stripe', wall: 0xb5482a, side: 0x7a3b2e, spin: [0x8c3b1f, 0xffd24a, 0xc2452d, 0x5aa83c], hazard: 'lava', decor: {shape: 'block', colors: [0xc97b63, 0xd9a273, 0x9c5f52]}},
		[S(14, {spin: 1}), JUMP(5), S(12, {bump: 3}), T('r'), S(16, {spin: 2}), UP(6, 1.5), S(8, {hazard: 2}), T('r'), S(10, {kind: 'sand'}), JUMP(5, 1), S(14, {bump: 4}), T('l'), HOLE()]),
	buildCourse({name: 'Cozinha gigante', sky: 0x7fd1c7, fog: 0xa9e2d8, g: 14, a: '#fff4d9', b: '#e8604c', pattern: 'check', wall: 0x2f6f8f, side: 0xe8d9b5, spin: [0xd5d8de], hazard: 'lava', floor: 0xe2c89a, decor: {shape: 'cyl', colors: [0xe8604c, 0xf7f7f7, 0xbfc4cc, 0xffc533]}},
		[S(12), S(6, {kind: 'belt'}), S(5), BOUNCE(2.5), S(14, {slide: 2}), DOWN(6, 2), T('l'), S(14, {kind: 'ice', spin: 1, cross: true}), T('l'), S(12, {slide: 2}), T('r'), S(12, {bump: 2}), HOLE()]),
	buildCourse({name: 'Festa no espaço', sky: 0x15102e, fog: 0x15102e, g: 7, a: '#231a55', b: '#37e0ff', pattern: 'grid', wall: 0xff3fa4, side: 0x2b2160, spin: [0x37e0ff], hazard: 'lava', decor: {shape: 'sphere', colors: [0xff8a3d, 0x8f6bff, 0x37e0ff, 0xff3fa4]}},
		[S(10), JUMP(9, 1), S(12, {bump: 3}), PORTAL(26, 8, 2), S(16, {spin: 2, cross: true}), JUMP(10), S(12), T('l'), S(14, {slide: 3}), HOLE()]),
	buildCourse({name: 'Praia do caranguejo', sky: 0x7fd3f7, fog: 0xbfeaf9, g: 14, a: '#f5deA0', b: '#efd28b', pattern: 'stripe', wall: 0xf25f4c, side: 0xd9b36c, spin: [0xf25f4c, 0xffffff], hazard: 'water', floor: 0x2aa7d6, decor: {shape: 'cone', colors: [0x2f9e5b, 0xf0c98a, 0x3bb273]}},
		[S(16, {slide: 2}), T('l'), S(12, {hazard: 2}), JUMP(6), S(14, {kind: 'sand'}), T('r'), S(18, {slide: 3, hazard: 2}), T('r'), S(10), UP(6, 2), S(12, {bump: 3}), T('l'), HOLE()]),
	buildCourse({name: 'Feira de domingo', sky: 0xffd166, fog: 0xffe29a, g: 14, a: '#ef476f', b: '#ffe1e8', pattern: 'stripe', wall: 0x118ab2, side: 0x7d4f2a, spin: [0xff8c42, 0x7ac74f, 0xffd166, 0xc2452d], hazard: 'lava', floor: 0x8fbc5a, decor: {shape: 'block', colors: [0x118ab2, 0xef476f, 0xfff1d6]}},
		[S(12, {bump: 4}), S(8, {kind: 'belt'}), T('r'), S(14, {spin: 2}), T('l'), S(14, {bump: 5}), BOUNCE(2), S(12, {slide: 2}), T('l'), S(8, {kind: 'belt'}), S(12), T('r'), S(12, {spin: 1, cross: true}), HOLE()]),
	buildCourse({name: 'Oficina do Seu Zé', sky: 0x4a5560, fog: 0x5d6a76, g: 14, a: '#59636e', b: '#66717d', pattern: 'grid', wall: 0xffb703, side: 0x2d343c, spin: [0xc9ced6, 0xffb703], hazard: 'lava', floor: 0x303841, decor: {shape: 'block', colors: [0xffb703, 0x8d99ae, 0xd62828]}},
		[S(12, {spin: 1, cross: true}), T('l'), S(12, {slide: 3}), UP(6, 2), S(10, {spin: 1, cross: true}), T('r'), S(8, {kind: 'belt'}), S(10, {hazard: 1}), JUMP(6, 1), S(14, {slide: 2}), T('r'), S(12, {bump: 3}), T('r'), HOLE()]),
	buildCourse({name: 'Mina do ouro', sky: 0x241a14, fog: 0x2d2118, g: 14, a: '#7a5a3c', b: '#6d4f33', pattern: 'stripe', wall: 0x9c6b30, side: 0x3b2a1e, spin: [0xffc533, 0x8a8f98], hazard: 'lava', floor: 0x1c1410, decor: {shape: 'cone', colors: [0x5a4634, 0x44352a, 0xffc533]}},
		[S(14), DOWN(8, 2.5), T('r'), S(14, {slide: 2}), BOUNCE(3), S(12, {spin: 2}), T('l'), DOWN(10, 3, {bump: 3}), S(8, {hazard: 2}), PORTAL(-24, 10), S(14, {slide: 3}), T('r'), S(10), JUMP(5, 1), S(10), HOLE()]),
	buildCourse({name: 'Geleira do pinguim', sky: 0xbfe3ff, fog: 0xe3f3ff, g: 14, a: '#e8f6ff', b: '#d2ecff', pattern: 'check', wall: 0x4aa3df, side: 0x9fd0ef, spin: [0x223344, 0xff9f1c], hazard: 'water', floor: 0x2d7fb8, width: 8, decor: {shape: 'cone', colors: [0xffffff, 0xcfe8f7, 0xa8d4ee]}},
		[S(14, {kind: 'ice'}), T('r'), S(14, {kind: 'ice', bump: 4}), UP(6, 1.5), T('l'), S(12, {kind: 'ice', hazard: 2}), JUMP(6), S(12, {kind: 'ice', spin: 1, cross: true}), T('l'), S(16, {kind: 'ice', slide: 3}), T('l'), S(8), HOLE()]),
	buildCourse({name: 'Vulcão de queijo', sky: 0x3a1a1a, fog: 0x5a2a20, g: 14, a: '#ffce3a', b: '#f6b92a', pattern: 'check', wall: 0x8c2f1b, side: 0x4a1f16, spin: [0x8c2f1b, 0xffce3a], hazard: 'lava', floor: 0xff5a1f, decor: {shape: 'cone', colors: [0x4a1f16, 0x6b2c1c, 0x2d1410]}},
		[S(12, {hazard: 2}), UP(8, 3), T('l'), S(14, {spin: 1}), S(8, {hazard: 1}), BOUNCE(2.5), S(12, {slide: 2}), T('r'), UP(8, 2), S(10, {bump: 4}), T('r'), JUMP(6, 2), S(12, {hazard: 3}), T('l'), DOWN(10, 3, {slide: 2}), S(8, {spin: 1, cross: true}), HOLE()]),
];
