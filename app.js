import { Application } from "@hotwired/stimulus";
import YoutubePlayer from "./controller.js";

const application = Application.start();
application.register("youtube-player", YoutubePlayer);
