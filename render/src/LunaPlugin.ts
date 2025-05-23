// Ensure that @triton/lib is loaded onto window for plugins to use shared memory space
import { Semaphore, Signal } from "@inrixia/helpers";
import quartz from "@uwu/quartz";
import { unloadSet } from "./helpers/unloadSet.js";
import { ReactiveStore } from "./ReactiveStore.js";

import { type LunaUnload } from "@luna/core";
import * as ftch from "./helpers/fetch.js";
import { modules } from "./modules.js";
import { coreTrace, Tracer } from "./trace";

type ModuleExports = {
	unloads?: Set<LunaUnload>;
	onUnload?: LunaUnload;
	Settings?: React.FC;
	errSignal?: Signal<string | undefined>;
};

export type LunaAuthor = {
	name: string;
	url: string;
	avatarUrl?: string;
};
export type PluginPackage = {
	name: string;
	hash: string;
	author?: LunaAuthor | string;
	description?: React.ReactNode;
	version?: string;
	dependencies?: string[];
	devDependencies?: string[];
	code?: string;
};

// If adding to this make sure that the values are initalized in LunaPlugin.fromStorage
export type LunaPluginStorage = {
	url: string;
	package: PluginPackage;
	enabled: boolean;
	liveReload: boolean;
};

type PartialLunaPluginStorage = Partial<LunaPluginStorage> & { url: string };

export class LunaPlugin {
	// #region Static
	public static fetchPackage(url: string): Promise<PluginPackage> {
		return ftch.json(`${url}.json`);
	}
	public static fetchCode(url: string): Promise<string> {
		return ftch.text(`${url}.js`);
	}

	// Storage backing for persisting plugin url/enabled/code etc... See LunaPluginStorage
	public static readonly pluginStorage: ReactiveStore<LunaPluginStorage> = ReactiveStore.getStore("@luna/plugins");
	// Static store for all loaded plugins so we dont double load any
	public static readonly plugins: Record<string, LunaPlugin> = {};

	// Static list of Luna plugins that should be seperate from user plugins
	public static readonly lunaPlugins: string[] = ["@luna/lib", "@luna/ui"];

	static {
		// Ensure all plugins are unloaded on beforeunload
		addEventListener("beforeunload", () => {
			for (const plugin of Object.values(LunaPlugin.plugins)) {
				plugin.unload().catch((err) => {
					const errMsg = `[Luna] Failed to unload plugin ${plugin.name}! Please report this to the Luna devs. ${err?.message}`;
					// Use alert here over logErr as Tidal may be partially unloaded
					alert(errMsg);
					console.error(errMsg, err);
				});
			}
		});
	}

	/**
	 * Create a plugin instance from a store:LunaPluginStorage, if package is not populated it will be fetched using the url so we can get the name
	 */
	public static async fromStorage(storeInit: PartialLunaPluginStorage): Promise<LunaPlugin> {
		// Ensure the url is sanitized incase users paste a link to the actual file
		storeInit.url = storeInit.url.replace(/(\.js|\.json|\.js.map)$/, "");

		storeInit.package ??= await this.fetchPackage(storeInit.url);
		const name = storeInit.package.name;

		if (name in this.plugins) return this.plugins[name];

		// Disable liveReload on load so people dont accidentally leave it on
		storeInit.liveReload ??= false;

		const store = await LunaPlugin.pluginStorage.get(name);
		LunaPlugin.pluginStorage.set(name, { ...store, ...storeInit });

		const plugin = (this.plugins[name] ??= new this(name, store));
		return plugin.load();
	}

	public static async loadStoredPlugins() {
		const keys = await LunaPlugin.pluginStorage.keys();
		return Promise.all(
			keys.map(async (name) =>
				LunaPlugin.fromStorage(await LunaPlugin.pluginStorage.get(name)).catch(this.trace.err.withContext("loadStoredPlugins", name)),
			),
		);
	}
	// #endregion

	// #region Tracer
	public static readonly trace: Tracer = coreTrace.withSource(".LunaPlugin").trace;
	public readonly trace: Tracer;
	// #endregion

	// #region constructor
	private constructor(
		public readonly name: string,
		public readonly store: LunaPluginStorage,
	) {
		this.trace = LunaPlugin.trace.withSource(`[${this.name}]`).trace;
		// Enabled has to be setup first because liveReload below accesses it
		this._enabled = new Signal(this.store.enabled, (next) => {
			// Protect against disabling permanantly in the background if loading causes a error
			// Restarting the client will attempt to load again
			if (this.loadError._ === undefined) this.store.enabled = next;
		});
		// Allow other code to listen to onEnabled (this._enabled is private)
		this.onSetEnabled = this._enabled.onValue.bind(this._enabled);

		this._liveReload = new Signal(this.store.liveReload, (next) => {
			if ((this.store.liveReload = next)) this.startReloadLoop();
			else this.stopReloadLoop();
		});
		this.onSetLiveReload = this._liveReload.onValue.bind(this._liveReload);
	}
	// #endregion

	// #region reloadLoop
	private _reloadTimeout?: NodeJS.Timeout;
	private startReloadLoop() {
		if (this._reloadTimeout) return;
		const reloadLoop = async () => {
			// Fail quietly
			await this.loadExports().catch(() => {});
			// Dont continue to loop if disabled or liveReload is false
			if (!this.enabled || !this._liveReload._) return;
			this._reloadTimeout = setTimeout(reloadLoop.bind(this), 1000);
		};
		// Immediately set reloadTimeout to avoid entering this multiple times
		this._reloadTimeout = setTimeout(reloadLoop);
	}
	private stopReloadLoop() {
		clearTimeout(this._reloadTimeout);
		this._reloadTimeout = undefined;
	}
	// #endregion

	// #region Signals
	public readonly loading: Signal<boolean> = new Signal(false);
	public readonly fetching: Signal<boolean> = new Signal(false);
	public readonly loadError: Signal<string | undefined> = new Signal(undefined);

	public readonly _liveReload: Signal<boolean>;
	public onSetLiveReload;
	public get liveReload() {
		return this._liveReload._;
	}
	public set liveReload(value: boolean) {
		this._liveReload._ = value;
	}

	private readonly _enabled: Signal<boolean>;
	public onSetEnabled;
	public get enabled() {
		return this._enabled._;
	}
	// #endregion

	public readonly dependents: Set<LunaPlugin> = new Set();

	// #region _exports
	public get exports(): ModuleExports | undefined {
		return modules[this.name];
	}
	private set exports(exports: ModuleExports | undefined) {
		if (this._unloads.size !== 0) {
			// If we always unload on load then we should never be here
			this.trace.msg.warn(`Plugin ${this.name} is trying to set exports but unloads are not empty! Please report this to the Luna devs.`);
			// This is a safety check to ensure we dont leak unloads
			// If there is somehow leftover unloads we need to add them to the new exports.unloads if it exists
			if (exports?.unloads !== undefined) {
				for (const unload of this._unloads) exports.unloads.add(unload);
				this._unloads.clear();
			}
		}
		modules[this.name] = exports;
	}
	private readonly _unloads: Set<LunaUnload> = new Set();
	private get unloads() {
		return this.exports?.unloads ?? this._unloads;
	}
	// #endregion

	// #region Storage
	public get url(): string {
		return this.store.url;
	}
	public get package(): PluginPackage | undefined {
		return this.store.package;
	}
	private set package(value: PluginPackage) {
		this.store.package = value;
	}
	// #endregion

	// #region load/unload
	/**
	 * Are you sure you didnt mean disable() or reload()?
	 * This will unload the plugin without disabling it!
	 */
	private async unload(): Promise<void> {
		try {
			this.loading._ = true;
			// Unload dependants before unloading this plugin
			for (const dependant of this.dependents) {
				this.trace.log(`Unloading dependant ${dependant.name}`);
				await dependant.unload();
			}
			await unloadSet(this.exports?.unloads);
		} finally {
			this.exports = undefined;
			this.loading._ = false;
		}
	}
	/**
	 * Load the plugin if it is enabled
	 */
	public async load(): Promise<LunaPlugin> {
		if (this.enabled) await this.enable();
		return this;
	}
	// #endregion

	// #region enable/disable
	public async enable() {
		try {
			this.loading._ = true;
			await this.loadExports();
			this._enabled._ = true;
			// Ensure live reload is running it it should be
			if (this._liveReload._) this.startReloadLoop();
		} finally {
			this.loading._ = false;
		}
	}
	public async disable() {
		// Disable the reload loop
		this.stopReloadLoop();
		await this.unload();
		this._enabled._ = false;
		this.loadError._ = undefined;
	}
	public async reload() {
		await this.disable();
		await this.enable();
	}

	public async uninstall() {
		await this.disable();
		this.loading._ = true;
		// Remove from storage
		await LunaPlugin.pluginStorage.del(this.name);
		delete LunaPlugin.plugins[this.name];
		delete modules[this.name];
		// Effectively uninstall
		delete (<any>this.store).package;
		for (const name in LunaPlugin.plugins) {
			// Just to be safe
			LunaPlugin.plugins[name].dependents.delete(this);
		}
		this.loading._ = false;
	}
	// #endregion

	// #region Fetch
	/**
	 * Returns true if code changed, should never be called outside of loadExports
	 */
	private async fetchPackage(): Promise<boolean> {
		try {
			this.fetching._ = true;
			const newPackage = await LunaPlugin.fetchPackage(this.url);
			// Delete this just to be safe
			delete newPackage.code;
			const codeChanged = this.package?.hash !== newPackage.hash;
			// If hash hasnt changed then just reuse stored code
			// If it has then next time this.code() is called it will fetch the new code as newPackage.code is undefined
			if (!codeChanged) newPackage.code = this.package?.code;
			// Only update this.package if its actually changed
			if (JSON.stringify(newPackage) !== JSON.stringify(this.package)) this.package = newPackage;
			return codeChanged;
		} catch {
			// Fail silently if we cant fetch
		} finally {
			this.fetching._ = false;
		}
		return false;
	}
	public async code() {
		return (this.package!.code ??= `${await LunaPlugin.fetchCode(this.url)}\n//# sourceURL=${this.url}.js`);
	}
	// #endregion

	// #region Load
	private readonly loadSemaphore: Semaphore = new Semaphore(1);
	private async loadExports(): Promise<void> {
		// Ensure we cant start loading midway through loading
		const release = await this.loadSemaphore.obtain();
		try {
			// If code hasnt changed and we have already loaded exports we are done
			if (!(await this.fetchPackage()) && this.exports !== undefined) return;

			const code = await this.code();
			// If code failed to fetch then nothing we can do
			if (code === undefined) return;
			this.loading._ = true;

			// Ensure we unload if previously loaded
			await this.unload();

			// Transforms are done at build so dont need quartz here (for now :3)
			this.exports = await quartz(code, {
				plugins: [
					{
						resolve: ({ name }) => {
							if (modules[name] === undefined) {
								this.trace.msg.err.throw(`Failed to load, module ${name} not found!`);
							}
							// Add this plugin to the dependents of the module if its a plugin and thus unloadable
							LunaPlugin.plugins[name]?.dependents.add(this);
							return `luna.core.modules["${name}"]`;
						},
					},
				],
			});

			// Ensure loadError is cleared
			this.loadError._ = undefined;

			const { onUnload, errSignal } = this.exports;

			if (onUnload !== undefined) {
				onUnload.source = "onUnload";
				this.unloads.add(onUnload);
			}
			if (errSignal !== undefined) {
				const unloadErrSignal: LunaUnload = errSignal.onValue((next) => (this.loadError._ = next));
				unloadErrSignal.source = "errSignal";
				this.unloads.add(unloadErrSignal);
			}

			// Prefix all unload sources with plugin name
			for (const unload of this.unloads) {
				unload.source = this.name + (unload.source ? `.${unload.source}` : "");
			}

			this.trace.log(`Loaded`);
			// Make sure we load any enabled dependants, this is mostly to facilitate live reloading dependency trees
			for (const dependant of this.dependents) {
				this.trace.log(`Loading dependant ${dependant.name}`);
				dependant.load().catch(this.trace.err.withContext(`Failed to load dependant ${dependant.name} of plugin ${this.name}`));
			}
		} catch (err) {
			// Set loadError for anyone listening
			this.loadError._ = (<any>err)?.message ?? err?.toString();
			// Notify users
			this.trace.msg.err.withContext(`Failed to load`)(err);
			// Ensure we arnt partially loaded
			await this.unload();
			// For sanity throw the error just to be safe
			throw err;
		} finally {
			release();
			this.loading._ = false;
		}
	}
	// #endregion
}
