// SPDX-License-Identifier: AGPL-3.0-or-later

import {GOLF_COLORS, type GolfPlayer} from '@app/features/voice/components/GolfEvents';
import golfSounds, {type GolfBallSound} from '@app/features/voice/components/GolfSounds';
import * as THREE from 'three';

const R = 0.22;
const AIM_PIXELS = 180;
const INTERPOLATION_DELAY = 0.1;
const AVATAR_LABEL_HEIGHT = 0.72;
const HEARING_DISTANCE = 45;
const DOT_COUNT = 9;
const MIN_POWER = 0.05;

interface Pad {
	x: number;
	z: number;
	w: number;
	d: number;
	y: number;
	sx: number;
	sz: number;
	kind: string;
	dir?: [number, number];
}

interface Wall {
	x: number;
	z: number;
	hx: number;
	hz: number;
	y: number;
	height: number;
	edge: number;
	sx: number;
	sz: number;
}

interface Spinner {
	x: number;
	y: number;
	z: number;
	len: number;
	w: number;
	cross: boolean;
}

interface Slider {
	x: number;
	y: number;
	z: number;
	hx: number;
	hz: number;
	ax: number;
	az: number;
	amp: number;
	speed: number;
}

export interface GolfCourse {
	name: string;
	sky: number;
	fog: number;
	a: string;
	b: string;
	pattern: 'stripe' | 'check' | 'grid';
	wall: number;
	side: number;
	spin: Array<number>;
	hazard: 'water' | 'lava';
	floor?: number;
	decor: {shape: 'block' | 'cyl' | 'cone' | 'sphere'; colors: Array<number>};
	pads: Array<Pad>;
	walls: Array<Wall>;
	spinners: Array<Spinner>;
	sliders: Array<Slider>;
	bumpers: Array<{x: number; y: number; z: number}>;
	teleports: Array<{from: [number, number, number]; to: [number, number, number]}>;
	way: Array<{x: number; z: number}>;
	hole: [number, number];
	holeY: number;
	minY: number;
}

export interface GolfFrame {
	time: number;
	balls: Array<[number, number, number, number]>;
	events: Array<[string, number, number]>;
}

export interface GolfShot {
	x: number;
	z: number;
	power: number;
}

type Paint = (g: CanvasRenderingContext2D) => void;

const stripes =
	(a: string, b: string): Paint =>
	(g) => {
		g.fillStyle = a;
		g.fillRect(0, 0, 128, 128);
		g.fillStyle = b;
		g.fillRect(0, 0, 128, 64);
	};
const checks =
	(a: string, b: string): Paint =>
	(g) => {
		g.fillStyle = a;
		g.fillRect(0, 0, 128, 128);
		g.fillStyle = b;
		g.fillRect(0, 0, 64, 64);
		g.fillRect(64, 64, 64, 64);
	};
const grid =
	(a: string, b: string): Paint =>
	(g) => {
		g.fillStyle = a;
		g.fillRect(0, 0, 128, 128);
		g.strokeStyle = b;
		g.lineWidth = 4;
		g.strokeRect(0, 0, 128, 128);
	};
const arrow =
	(base: string, mark: string): Paint =>
	(g) => {
		g.fillStyle = base;
		g.fillRect(0, 0, 128, 128);
		g.fillStyle = mark;
		g.beginPath();
		g.moveTo(16, 84);
		g.lineTo(64, 36);
		g.lineTo(112, 84);
		g.lineTo(88, 84);
		g.lineTo(64, 60);
		g.lineTo(40, 84);
		g.fill();
	};
const PATTERN = {stripe: stripes, check: checks, grid};
const PAINT: Record<string, Paint> = {
	ice: stripes('#fff3a6', '#ffe67a'),
	sand: (g) => {
		g.fillStyle = '#3a3030';
		g.fillRect(0, 0, 128, 128);
		for (let i = 0; i < 90; i++) {
			g.fillStyle = i % 3 ? '#574747' : '#ff7a2e';
			g.fillRect((i * 53) % 128, (i * 97) % 128, 7, 7);
		}
	},
	belt: arrow('#39404d', '#ffc533'),
	boost: arrow('#ff3fa4', '#ffffff'),
	jump: checks('#ff5a36', '#ffc533'),
	lava: stripes('#ff4d1a', '#ffb01f'),
	water: stripes('#2aa7d6', '#6fd3f2'),
};

function makeTexture(paint: Paint, repeatX: number, repeatY: number): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 128;
	const context = canvas.getContext('2d');
	if (context) paint(context);
	const texture = new THREE.CanvasTexture(canvas);
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.repeat.set(repeatX, repeatY);
	return texture;
}

function nameTag(text: string): THREE.Sprite {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 64;
	const g = canvas.getContext('2d');
	if (g) {
		g.font = '700 32px sans-serif';
		g.textAlign = 'center';
		g.lineWidth = 7;
		g.strokeStyle = 'rgba(0, 0, 0, 0.65)';
		g.strokeText(text, 128, 44, 244);
		g.fillStyle = '#fff';
		g.fillText(text, 128, 44, 244);
	}
	const sprite = new THREE.Sprite(
		new THREE.SpriteMaterial({map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true}),
	);
	sprite.scale.set(2, 0.5, 1);
	return sprite;
}

const lambert = (color: number, map: THREE.Texture | null = null) => new THREE.MeshLambertMaterial({color, map});
const hash = (n: number) => {
	const value = Math.sin(n * 127.1) * 43758.5453;
	return value - Math.floor(value);
};

function shearTop(geometry: THREE.BufferGeometry, lift: number, sx: number, sz: number): void {
	const position = geometry.attributes.position;
	for (let i = 0; i < position.count; i++) {
		position.setY(i, position.getY(i) + lift + sx * position.getX(i) + sz * position.getZ(i));
	}
	geometry.computeVertexNormals();
}

interface BallView {
	mesh: THREE.Mesh;
	tag: THREE.Sprite;
	gone: number;
}

interface SpinnerView {
	spinner: Spinner;
	group: THREE.Group;
}

interface SliderView {
	slider: Slider;
	group: THREE.Group;
}

// Desenha a pista que o servidor manda e devolve as tacadas. Quem decide o que acontece com a bola é o servidor.
export class GolfScene {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 600);
	private readonly abort = new AbortController();
	private readonly keys = new Set<string>();
	private readonly focus = new THREE.Vector3();
	private readonly resizeObserver: ResizeObserver;
	private scene = new THREE.Scene();
	private sun: THREE.DirectionalLight | null = null;
	private course: GolfCourse | null = null;
	private frames: Array<GolfFrame> = [];
	private players: Array<GolfPlayer> = [];
	private balls: Array<BallView> = [];
	private spinners: Array<SpinnerView> = [];
	private sliders: Array<SliderView> = [];
	private bumpers: Array<{mesh: THREE.Mesh; pulse: number}> = [];
	private textures: Array<{texture: THREE.Texture; speed: number}> = [];
	private dots: Array<THREE.Mesh> = [];
	private confetti: Array<{points: THREE.Points; age: number; seeds: Array<[number, number, number]>}> = [];
	private flag: THREE.Mesh | null = null;
	private clockOffset: number | null = null;
	private you: number | null = null;
	private canShoot = false;
	private yaw = 0;
	private pitch = 0.5;
	private distance = 9;
	private zoom = 9;
	private autoYaw = true;
	private overview = false;
	private aim: {x0: number; y0: number; x: number; y: number} | null = null;
	private orbit: {x: number; y: number} | null = null;
	private lastRender = performance.now();
	private animationFrame = 0;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly onShot: (shot: GolfShot) => void,
		private readonly onPower: (power: number) => void,
	) {
		this.renderer = new THREE.WebGLRenderer({canvas, antialias: true});
		this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		this.renderer.shadowMap.enabled = true;
		this.bindInput();
		this.resizeObserver = new ResizeObserver(() => this.resize());
		if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
		this.resize();
		this.animationFrame = requestAnimationFrame(this.frame);
	}

	private bindInput(): void {
		const {canvas} = this;
		const {signal} = this.abort;
		canvas.addEventListener('contextmenu', (event) => event.preventDefault(), {signal});
		canvas.addEventListener(
			'pointerdown',
			(event) => {
				canvas.setPointerCapture(event.pointerId);
				if (event.button === 0 && this.canAim()) {
					this.aim = {x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY};
				} else {
					this.orbit = {x: event.clientX, y: event.clientY};
				}
			},
			{signal},
		);
		canvas.addEventListener(
			'pointermove',
			(event) => {
				if (this.aim) {
					this.aim.x = event.clientX;
					this.aim.y = event.clientY;
				}
				if (this.orbit) {
					this.yaw -= (event.clientX - this.orbit.x) * 0.006;
					this.pitch = Math.max(0.15, Math.min(1.35, this.pitch + (event.clientY - this.orbit.y) * 0.004));
					this.orbit = {x: event.clientX, y: event.clientY};
					this.autoYaw = false;
				}
			},
			{signal},
		);
		canvas.addEventListener(
			'pointerup',
			() => {
				if (this.aim) {
					const shot = this.aimShot();
					if (shot.power > MIN_POWER && this.canAim()) {
						this.onShot(shot);
						this.autoYaw = true;
					}
				}
				this.aim = null;
				this.orbit = null;
			},
			{signal},
		);
		canvas.addEventListener(
			'wheel',
			(event) => {
				event.preventDefault();
				this.distance = Math.max(4, Math.min(30, this.distance + event.deltaY * 0.01));
			},
			{passive: false, signal},
		);
		window.addEventListener('keydown', (event) => this.keys.add(event.key.toLowerCase()), {signal});
		window.addEventListener('keyup', (event) => this.keys.delete(event.key.toLowerCase()), {signal});
		window.addEventListener(
			'keydown',
			(event) => {
				if (event.key.toLowerCase() === 'm') this.toggleOverview();
			},
			{signal},
		);
	}

	private resize(): void {
		const parent = this.canvas.parentElement;
		if (!parent) return;
		const {clientWidth: width, clientHeight: height} = parent;
		if (width === 0 || height === 0) return;
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	get time(): number {
		return performance.now() / 1000 + (this.clockOffset ?? 0);
	}

	private get myBall(): GolfFrame['balls'][number] | undefined {
		return this.you === null ? undefined : this.frames.at(-1)?.balls[this.you];
	}

	private canAim(): boolean {
		return this.canShoot && this.myBall?.[3] === 1;
	}

	toggleOverview(): boolean {
		this.overview = !this.overview;
		return this.overview;
	}

	setPlayers(players: Array<GolfPlayer>, you: number | null, canShoot: boolean): void {
		const renamed = players.length !== this.players.length || players.some((p, i) => p.name !== this.players[i].name);
		this.players = players;
		this.you = you;
		this.canShoot = canShoot && you !== null && !players[you].done && !players[you].out;
		if (renamed) this.buildBalls();
		players.forEach((player, index) => {
			const view = this.balls[index];
			if (view) view.mesh.visible = view.tag.visible = !player.out;
		});
	}

	private buildBalls(): void {
		for (const {mesh, tag} of this.balls) this.scene.remove(mesh, tag);
		this.balls = this.players.map((player, index) => {
			const mesh = new THREE.Mesh(
				new THREE.SphereGeometry(R, 24, 18),
				lambert(GOLF_COLORS[index % GOLF_COLORS.length]),
			);
			mesh.castShadow = true;
			const tag = nameTag(player.name);
			this.scene.add(mesh, tag);
			return {mesh, tag, gone: 0};
		});
	}

	private add<T extends THREE.Mesh>(mesh: T): T {
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		this.scene.add(mesh);
		return mesh;
	}

	private box(
		width: number,
		height: number,
		depth: number,
		color: number,
		x: number,
		y: number,
		z: number,
	): THREE.Mesh {
		const mesh = this.add(new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), lambert(color)));
		mesh.position.set(x, y, z);
		return mesh;
	}

	private cylinder(
		radius: number,
		height: number,
		color: number,
		x: number,
		y: number,
		z: number,
		top = radius,
	): THREE.Mesh {
		const mesh = this.add(new THREE.Mesh(new THREE.CylinderGeometry(top, radius, height, 24), lambert(color)));
		mesh.position.set(x, y, z);
		return mesh;
	}

	private addPad(pad: Pad, course: GolfCourse): void {
		const geometry = new THREE.BoxGeometry(pad.w, 0.7, pad.d);
		geometry.translate(0, -0.35, 0);
		shearTop(geometry, 0, pad.sx, pad.sz);
		const paint =
			pad.kind === 'grass'
				? PATTERN[course.pattern](course.a, course.b)
				: PAINT[pad.kind === 'hazard' ? course.hazard : pad.kind];
		const top = makeTexture(paint, Math.max(1, pad.w / 2), Math.max(1, pad.d / 2));
		if ((pad.kind === 'belt' || pad.kind === 'boost') && pad.dir) {
			top.center.set(0.5, 0.5);
			top.rotation = Math.atan2(pad.dir[0], pad.dir[1]) + (pad.kind === 'belt' ? 0 : Math.PI);
			this.textures.push({texture: top, speed: 1.6});
		}
		if (pad.kind === 'hazard') this.textures.push({texture: top, speed: 0.3});
		const side = lambert(course.side);
		const mesh = this.add(new THREE.Mesh(geometry, [side, side, lambert(0xffffff, top), side, side, side]));
		mesh.position.set(pad.x, pad.y, pad.z);
	}

	private addWall(wall: Wall, color: number): void {
		const geometry = new THREE.BoxGeometry(wall.hx * 2, wall.height + 0.7, wall.hz * 2);
		geometry.translate(0, (wall.height - 0.7) / 2, 0);
		shearTop(geometry, wall.edge, wall.sx, wall.sz);
		const mesh = this.add(new THREE.Mesh(geometry, lambert(color)));
		mesh.position.set(wall.x, wall.y, wall.z);
	}

	private spinnerArm(spinner: Spinner, group: THREE.Group, angle: number, colors: Array<number>): void {
		const arm = new THREE.Group();
		arm.rotation.y = angle;
		const bar = new THREE.Mesh(new THREE.BoxGeometry(spinner.len * 2, 0.12, 0.12), lambert(colors[0]));
		bar.castShadow = true;
		arm.add(bar);
		for (let i = 0; i < 6; i++) {
			const piece = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), lambert(colors[i % colors.length]));
			piece.position.x = -spinner.len + 0.3 + i * ((spinner.len * 2 - 0.6) / 5);
			piece.castShadow = true;
			arm.add(piece);
		}
		group.add(arm);
	}

	private addSpinner(spinner: Spinner, colors: Array<number>): void {
		const group = new THREE.Group();
		group.position.set(spinner.x, spinner.y, spinner.z);
		this.spinnerArm(spinner, group, 0, colors);
		if (spinner.cross) this.spinnerArm(spinner, group, Math.PI / 2, colors);
		const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 1, 12), lambert(0x444a55));
		hub.castShadow = true;
		group.add(hub);
		this.scene.add(group);
		this.spinners.push({spinner, group});
	}

	private addSlider(slider: Slider, course: GolfCourse): void {
		const group = new THREE.Group();
		group.position.set(slider.x, slider.y, slider.z);
		const head = new THREE.Mesh(
			new THREE.BoxGeometry(slider.hx * 2, 0.7, slider.hz * 2),
			lambert(course.spin[1] ?? course.spin[0]),
		);
		head.castShadow = true;
		const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8), lambert(course.wall));
		handle.position.y = 1.9;
		handle.castShadow = true;
		group.add(head, handle);
		this.scene.add(group);
		this.sliders.push({slider, group});
	}

	private addDecor(course: GolfCourse): void {
		const {shape, colors} = course.decor;
		const xs = course.pads.flatMap((pad) => [pad.x - pad.w / 2, pad.x + pad.w / 2]);
		const zs = course.pads.flatMap((pad) => [pad.z - pad.d / 2, pad.z + pad.d / 2]);
		const [minX, maxX, minZ, maxZ] = [
			Math.min(...xs) - 34,
			Math.max(...xs) + 34,
			Math.min(...zs) - 34,
			Math.max(...zs) + 34,
		];
		const base = course.minY - 9;
		if (course.floor) {
			const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), lambert(course.floor));
			floor.receiveShadow = true;
			floor.rotation.x = -Math.PI / 2;
			floor.position.y = base;
			this.scene.add(floor);
		} else {
			const stars = new THREE.BufferGeometry();
			const points: Array<number> = [];
			for (let i = 0; i < 1400; i++) {
				points.push((hash(i) - 0.5) * 340, (hash(i + 5000) - 0.5) * 200, (hash(i + 9000) - 0.5) * 340);
			}
			stars.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
			this.scene.add(new THREE.Points(stars, new THREE.PointsMaterial({color: 0xffffff, size: 0.5})));
		}
		for (let i = 0; i < 110; i++) {
			const x = minX + hash(i + 1) * (maxX - minX);
			const z = minZ + hash(i + 200) * (maxZ - minZ);
			if (course.pads.some((pad) => Math.abs(x - pad.x) < pad.w / 2 + 7 && Math.abs(z - pad.z) < pad.d / 2 + 7))
				continue;
			const color = colors[i % colors.length];
			const size = 2.5 + hash(i + 400) * 5;
			const height = 4 + hash(i + 600) * 12;
			if (shape === 'block') this.box(size * 1.3, height, size * 1.3, color, x, base + height / 2, z);
			if (shape === 'cyl') this.cylinder(size * 0.7, height * 0.6, color, x, base + height * 0.3, z, size * 0.85);
			if (shape === 'cone') {
				const mesh = this.add(new THREE.Mesh(new THREE.ConeGeometry(size, height, 7), lambert(color)));
				mesh.position.set(x, base + height / 2, z);
			}
			if (shape === 'sphere') {
				const mesh = new THREE.Mesh(new THREE.SphereGeometry(size * 0.7, 18, 14), lambert(color));
				mesh.position.set(x, base + hash(i + 800) * 26, z);
				this.scene.add(mesh);
			}
		}
	}

	private disposeScene(): void {
		this.scene.traverse((object) => {
			if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite)) return;
			object.geometry.dispose();
			for (const material of [object.material].flat()) {
				(material as THREE.MeshLambertMaterial).map?.dispose();
				material.dispose();
			}
		});
	}

	setCourse(course: GolfCourse): void {
		this.disposeScene();
		this.course = course;
		this.frames = [];
		this.clockOffset = null;
		this.spinners = [];
		this.sliders = [];
		this.bumpers = [];
		this.textures = [];
		this.confetti = [];
		this.yaw = 0;
		this.autoYaw = true;
		this.overview = false;
		const scene = new THREE.Scene();
		this.scene = scene;
		scene.background = new THREE.Color(course.sky);
		scene.fog = new THREE.Fog(course.fog, 70, 260);
		scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 1.5));
		const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		Object.assign(sun.shadow.camera, {left: -42, right: 42, top: 42, bottom: -42, far: 120});
		scene.add(sun, sun.target);
		this.sun = sun;
		for (const pad of course.pads) this.addPad(pad, course);
		for (const wall of course.walls) this.addWall(wall, course.wall);
		for (const spinner of course.spinners) this.addSpinner(spinner, course.spin);
		for (const slider of course.sliders) this.addSlider(slider, course);
		for (const bumper of course.bumpers) {
			const mesh = this.cylinder(0.55, 0.7, 0xff3f5e, bumper.x, bumper.y + 0.35, bumper.z);
			this.bumpers.push({mesh, pulse: 0});
		}
		for (const {from, to} of course.teleports) {
			for (const [[x, y, z], color] of [
				[from, 0x37e0ff],
				[to, 0xff3fa4],
			] as const) {
				const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 10, 32), new THREE.MeshBasicMaterial({color}));
				ring.rotation.x = Math.PI / 2;
				ring.position.set(x, y + 0.08, z);
				scene.add(ring);
			}
		}
		const [holeX, holeZ] = course.hole;
		const cup = new THREE.Mesh(new THREE.CircleGeometry(0.36, 28), new THREE.MeshBasicMaterial({color: 0x0b0b0f}));
		cup.rotation.x = -Math.PI / 2;
		cup.position.set(holeX, course.holeY + 0.02, holeZ);
		scene.add(cup);
		this.cylinder(0.035, 2.4, 0xf4f4f4, holeX, course.holeY + 1.2, holeZ);
		this.flag = this.box(0.75, 0.42, 0.03, 0xff3b30, holeX + 0.39, course.holeY + 2.15, holeZ);
		this.addDecor(course);
		this.dots = Array.from({length: DOT_COUNT}, () => {
			const dot = new THREE.Mesh(
				new THREE.SphereGeometry(0.09, 10, 8),
				new THREE.MeshBasicMaterial({color: 0xffffff}),
			);
			dot.visible = false;
			scene.add(dot);
			return dot;
		});
		this.buildBalls();
	}

	addFrame(frame: GolfFrame): void {
		const offset = frame.time - performance.now() / 1000;
		this.clockOffset = this.clockOffset === null ? offset : this.clockOffset + (offset - this.clockOffset) * 0.1;
		const isFirst = this.frames.length === 0;
		this.frames.push(frame);
		if (this.frames.length > 8) this.frames.shift();
		if (isFirst)
			this.focus.set(frame.balls[this.you ?? 0][0], frame.balls[this.you ?? 0][1], frame.balls[this.you ?? 0][2]);
		for (const [kind, ballIndex, strength] of frame.events) this.handleEvent(kind, ballIndex, strength, frame);
	}

	private handleEvent(kind: string, ballIndex: number, strength: number, frame: GolfFrame): void {
		const [x, y, z] = frame.balls[ballIndex];
		const distance = this.focus.distanceTo(new THREE.Vector3(x, y, z));
		const volume = ballIndex === this.you ? 1 : Math.max(0.1, Math.min(0.75, 1 - distance / HEARING_DISTANCE));
		const sound = (kind === 'hazard' ? this.course?.hazard : kind) as GolfBallSound;
		golfSounds.play(sound, strength, volume);
		if (kind === 'bumper') {
			const nearest = this.bumpers.reduce<{mesh: THREE.Mesh; pulse: number} | null>((best, bumper) => {
				const closer =
					!best ||
					bumper.mesh.position.distanceTo(new THREE.Vector3(x, y, z)) <
						best.mesh.position.distanceTo(new THREE.Vector3(x, y, z));
				return closer ? bumper : best;
			}, null);
			if (nearest) nearest.pulse = 1;
		}
		if (kind === 'sink') this.burst(ballIndex);
	}

	private burst(ballIndex: number): void {
		const {course} = this;
		if (!course) return;
		const count = 70;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
		const color = GOLF_COLORS[ballIndex % GOLF_COLORS.length];
		const points = new THREE.Points(geometry, new THREE.PointsMaterial({color, size: 0.16}));
		points.position.set(course.hole[0], course.holeY + 0.2, course.hole[1]);
		this.scene.add(points);
		const seeds = Array.from(
			{length: count},
			() => [Math.random() * 6 - 3, 4 + Math.random() * 5, Math.random() * 6 - 3] as [number, number, number],
		);
		this.confetti.push({points, age: 0, seeds});
	}

	private ballsAt(time: number): Array<[number, number, number, number]> {
		const {frames} = this;
		const last = frames.at(-1);
		if (!last) return [];
		const after = frames.findIndex((frame) => frame.time >= time);
		if (after <= 0) return after === 0 ? frames[0].balls : last.balls;
		const from = frames[after - 1];
		const to = frames[after];
		const t = (time - from.time) / Math.max(0.001, to.time - from.time);
		return to.balls.map((ball, index) => {
			const start = from.balls[index];
			return [
				start[0] + (ball[0] - start[0]) * t,
				start[1] + (ball[1] - start[1]) * t,
				start[2] + (ball[2] - start[2]) * t,
				ball[3],
			];
		});
	}

	private aimShot(): GolfShot {
		const aim = this.aim;
		if (!aim) return {x: 0, z: 1, power: 0};
		const forwardX = Math.sin(this.yaw);
		const forwardZ = Math.cos(this.yaw);
		const rightX = -Math.cos(this.yaw);
		const rightZ = Math.sin(this.yaw);
		const dx = aim.x - aim.x0;
		const dy = aim.y - aim.y0;
		const worldX = -dx * rightX + dy * forwardX;
		const worldZ = -dx * rightZ + dy * forwardZ;
		const length = Math.hypot(worldX, worldZ) || 1;
		return {x: worldX / length, z: worldZ / length, power: Math.min(1, Math.hypot(dx, dy) / AIM_PIXELS)};
	}

	private followedIndex(): number {
		const {you, players} = this;
		if (you !== null && !players[you]?.done && !players[you]?.out) return you;
		const next = players.findIndex((player) => !player.done && !player.out);
		return next === -1 ? (you ?? 0) : next;
	}

	private turnToNextStretch(ball: [number, number, number, number], dt: number): void {
		const way = this.course?.way ?? [];
		if (way.length === 0) return;
		let nearest = 0;
		way.forEach((point, index) => {
			if (
				Math.hypot(point.x - ball[0], point.z - ball[2]) <
				Math.hypot(way[nearest].x - ball[0], way[nearest].z - ball[2])
			) {
				nearest = index;
			}
		});
		const target = way[Math.min(way.length - 1, nearest + 2)];
		const want = Math.atan2(target.x - ball[0], target.z - ball[2]);
		const difference = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
		this.yaw += difference * Math.min(1, dt * 2.5);
	}

	private updateObstacles(time: number, dt: number): void {
		for (const {spinner, group} of this.spinners) group.rotation.y = -spinner.w * time;
		for (const {slider, group} of this.sliders) {
			const at = slider.amp * Math.sin(slider.speed * time);
			group.position.x = slider.x + slider.ax * at;
			group.position.z = slider.z + slider.az * at;
		}
		for (const bumper of this.bumpers) {
			bumper.pulse = Math.max(0, bumper.pulse - dt * 4);
			const scale = 1 + bumper.pulse * 0.28;
			bumper.mesh.scale.set(scale, 1, scale);
		}
		for (const {texture, speed} of this.textures) texture.offset.y += speed * dt;
		if (this.flag) this.flag.rotation.y = Math.sin(time * 3) * 0.18;
	}

	private updateBalls(balls: Array<[number, number, number, number]>, dt: number): void {
		this.balls.forEach((view, index) => {
			const ball = balls[index];
			if (!ball) return;
			view.gone = ball[3] === 2 ? Math.min(1, view.gone + dt * 3) : 0;
			view.mesh.position.set(ball[0], ball[1] - view.gone * 0.3, ball[2]);
			view.mesh.scale.setScalar(Math.max(1 - view.gone, 0.001));
			view.tag.position.set(ball[0], ball[1] + AVATAR_LABEL_HEIGHT, ball[2]);
			if (ball[3] === 2) view.tag.visible = false;
		});
	}

	private updateConfetti(dt: number): void {
		this.confetti = this.confetti.filter((burst) => {
			burst.age += dt;
			const position = burst.points.geometry.attributes.position;
			burst.seeds.forEach(([vx, vy, vz], index) => {
				position.setXYZ(index, vx * burst.age, vy * burst.age - 6 * burst.age * burst.age, vz * burst.age);
			});
			position.needsUpdate = true;
			if (burst.age < 1.6) return true;
			this.scene.remove(burst.points);
			return false;
		});
	}

	private updateCamera(balls: Array<[number, number, number, number]>, dt: number): void {
		const {course, camera} = this;
		if (!course) return;
		if (this.keys.has('q') || this.keys.has('arrowleft')) {
			this.yaw += dt * 1.8;
			this.autoYaw = false;
		}
		if (this.keys.has('e') || this.keys.has('arrowright')) {
			this.yaw -= dt * 1.8;
			this.autoYaw = false;
		}
		const followed = balls[this.followedIndex()];
		if (followed && this.autoYaw && followed[3] === 1 && !this.aim) this.turnToNextStretch(followed, dt);
		const xs = course.pads.map((pad) => pad.x);
		const zs = course.pads.map((pad) => pad.z);
		const middle = new THREE.Vector3(
			(Math.min(...xs) + Math.max(...xs)) / 2,
			0,
			(Math.min(...zs) + Math.max(...zs)) / 2,
		);
		const wide = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 1.15 + 16;
		const target = this.overview || !followed ? middle : new THREE.Vector3(followed[0], followed[1], followed[2]);
		this.focus.lerp(target, Math.min(1, dt * (this.overview ? 3 : 6)));
		this.zoom += ((this.overview ? wide : this.distance) - this.zoom) * Math.min(1, dt * 4);
		const tilt = this.overview ? 1.05 : this.pitch;
		const flat = this.zoom * Math.cos(tilt);
		const {focus, yaw} = this;
		camera.position.set(
			focus.x - Math.sin(yaw) * flat,
			focus.y + this.zoom * Math.sin(tilt),
			focus.z - Math.cos(yaw) * flat,
		);
		camera.lookAt(focus.x, focus.y + 0.4, focus.z);
		if (this.sun) {
			this.sun.position.set(focus.x + 12, focus.y + 22, focus.z - 10);
			this.sun.target.position.copy(focus);
		}
	}

	private updateAim(balls: Array<[number, number, number, number]>): void {
		const shot = this.aim ? this.aimShot() : null;
		const ball = this.you === null ? undefined : balls[this.you];
		this.onPower(shot?.power ?? 0);
		this.dots.forEach((dot, index) => {
			dot.visible = Boolean(shot && ball) && (shot?.power ?? 0) > MIN_POWER;
			if (!dot.visible || !shot || !ball) return;
			const along = 0.5 + index * (0.35 + shot.power * 0.75);
			dot.position.set(ball[0] + shot.x * along, ball[1] - 0.1, ball[2] + shot.z * along);
		});
	}

	private frame = (now: number): void => {
		const dt = Math.min(0.05, (now - this.lastRender) / 1000);
		this.lastRender = now;
		const time = this.time - INTERPOLATION_DELAY;
		const balls = this.ballsAt(time);
		this.updateObstacles(time, dt);
		this.updateBalls(balls, dt);
		this.updateConfetti(dt);
		this.updateCamera(balls, dt);
		this.updateAim(balls);
		this.renderer.render(this.scene, this.camera);
		this.animationFrame = requestAnimationFrame(this.frame);
	};

	dispose(): void {
		cancelAnimationFrame(this.animationFrame);
		this.abort.abort();
		this.resizeObserver.disconnect();
		this.disposeScene();
		this.renderer.dispose();
	}
}
