import { getPlayer, onPlayerCreated } from "./engine";
import { FftSubscriptions } from "./fftSubscriptions";

export const fftSubscriptions = new FftSubscriptions((enabled) =>
  getPlayer().setFftEnabled(enabled),
);

onPlayerCreated((player) => player.setFftEnabled(fftSubscriptions.enabled));
