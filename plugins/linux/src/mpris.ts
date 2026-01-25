import { MediaItem, PlayState } from "@luna/lib";
import { linuxTrace, unloads } from "./index.safe";

if (!("mediaSession" in navigator)) {
	linuxTrace.warn("MediaSession API not available");
} else {
	linuxTrace.log("MPRIS enabled");

	let currentNotification: Notification | null = null;

	MediaItem.onMediaTransition(unloads, async (mediaItem) => {
		const [title, artistPromises, album, coverUrl] = await Promise.all([
			mediaItem.title(),
			mediaItem.artists(),
			mediaItem.album().then((a) => a?.title() ?? ""),
			mediaItem.coverUrl(),
		]);

		const artists = await Promise.all(artistPromises);
		const artistStr = artists?.map((a) => a?.name ?? "").join(", ") ?? "Unknown";

		navigator.mediaSession.metadata = new MediaMetadata({
			title: title ?? "Unknown",
			artist: artistStr,
			album: album ?? "",
			artwork: coverUrl ? [{ src: coverUrl, sizes: "640x640", type: "image/jpeg" }] : [],
		});

		// Show notification on track change
		if (Notification.permission === "granted") {
			if (currentNotification) currentNotification.close();
			currentNotification = new Notification(title ?? "Unknown", { body: artistStr, icon: coverUrl ?? undefined, silent: true });
		} else if (Notification.permission === "default") {
			Notification.requestPermission();
		}
	});

	PlayState.onState(unloads, (state) => {
		navigator.mediaSession.playbackState = state === "PLAYING" ? "playing" : state === "PAUSED" ? "paused" : "none";
	});

	navigator.mediaSession.setActionHandler("play", () => PlayState.play());
	navigator.mediaSession.setActionHandler("pause", () => PlayState.pause());
	navigator.mediaSession.setActionHandler("nexttrack", () => PlayState.next());
	navigator.mediaSession.setActionHandler("previoustrack", () => PlayState.previous());

	unloads.add(() => {
		navigator.mediaSession.metadata = null;
		navigator.mediaSession.setActionHandler("play", null);
		navigator.mediaSession.setActionHandler("pause", null);
		navigator.mediaSession.setActionHandler("nexttrack", null);
		navigator.mediaSession.setActionHandler("previoustrack", null);
	});
}
