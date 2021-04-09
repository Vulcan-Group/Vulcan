/**
 * ? Manager File: Music
 * Represents a layer of control between the music commands and the music stream.
 * TODO: Abstract for more than just 'youtube' links.
 * TODO: Fix errors with autoplay and songs being processed in between.
 */

/* eslint-disable class-methods-use-this */
const got = xrequire('got');
const ytsr = xrequire('ytsr');
const EventEmitter = require('events');
const cheerio = xrequire('cheerio');
const caller = xrequire('caller-id');
const Discord = xrequire('discord.js');
const ytdl = xrequire('ytdl-core-discord');
const messageEmbeds = xrequire('./modules/messageEmbeds');
const logger = xrequire('./modules/logger').getInstance();

/**
 * ! Every guild has a copy of this object.
 *
 * ? Limitations
 * Because of the reliance of youtube as the only source of music streaming
 * there are a few limitations:
 *   - Regionally restricted (requires a proxy)
 *   - Private
 *   - Rentals
 *
 * ? Music can be queued via the .request() which parses a request
 * Thus far a request resolvable can be:
 *   - URL (yt)
 *   - ID (yt)
 *   - Search query (yt)
 */

class MusicManager extends EventEmitter {
  constructor(guild) {
    super();

    // Init properties
    this.client = guild.client;
    this.guild = guild;
    this.history = [];
    this.queue = [];
    this.checks = [];

    // Default
    this.autoplay = true;
    this.repeat = false;
    this.shuffle = false;
    this.loading = false;
    this.shouldPause = false;
    this.afkTimeout = 2 * (60 * 100); // 2 minutes
    this.maxHistory = 100; // History array max size

    // Assigned by methods
    this.connection = null; // * The connection object to the voice channel. (assigned on join)
    this.dispatcher = null; // * The music dispatcher. (created on music play (_enqueue))
    this.currentTask = null; // * The loaded task. (created on processing a request)

    // Self events
    this.on('timeoutLeave', this._onTimeoutLeave);
    this.on('taskRepeat', this._onTaskRepeat);
  }

  /************************
   * Accessors & Mutators *
   *************************/

  get connected() {
    return this.connection && this.connection.channel;
  }

  get paused() {
    return this.dispatcher && this.dispatcher.paused;
  }

  get idle() {
    return this.connected && !this.dispatcher && !this.loading;
  }

  get playing() {
    return !this.paused;
  }

  get free() {
    return this.queue.length <= 0;
  }

  /********************
   * Event functions  *
   * ? Self           *
   ********************/

  async _onTimeoutLeave() {
    // May happen if always idle
    const source = this.currentTask ? this.currentTask.source : this.guild.botChannel;

    // Beautify
    const f = Math.formatMilliseconds;
    const df = 'Unknown';

    await source.send(
      messageEmbeds.musicManager({
        title: `Inactivity Leave`,
        description: `Voice **inactivity** detected.\nLeft voice to save resources.`,
        fields: [
          { name: 'Timeout', value: `${f(this.afkTimeout)}` || df, inline: true },
          { name: 'Channel', value: `\`${this.connection.channel.name}\`` || df, inline: true }
        ]
      })
    );
  }

  async _onTaskRepeat() {
    // May happen if always idle
    const source = this.currentTask ? this.currentTask.source : this.guild.botChannel;

    await source.send(
      messageEmbeds.musicManager({
        title: `Task Repeat`,
        description: `Task repeat is **enabled**.\nRepeating previously queued task.`
      })
    );
  }

  /********************
   * Event functions  *
   * ? Dispatcher     *
   ********************/

  async _onVolumeChange(oldValue, newValue) {
    // Beautify
    const source = this.currentTask.source;
    const df = 'Unknown';

    await source.send(
      messageEmbeds.musicManager({
        description: `Music Manager has changed stream volume.`,
        field: [
          { name: 'Old Volume', value: oldValue || df },
          { name: 'New Volume', value: newValue || df }
        ]
      })
    );
  }

  async _onStartPlaying() {
    // Destructor task
    const { requester, source, song } = this.currentTask;

    // Useful for time update
    const starTime = Date.now();
    const duration = song.seconds * 1000;
    const endTime = starTime + duration;

    // Beautify
    const f = Math.formatMilliseconds;
    const df = 'Unknown';
    const line = '=======';
    const wrap = messageEmbeds.musicManager({
      title: `:notes:  Now Playing`,
      fields: [
        { name: 'Song', value: `\`${song.name}\`` || df, inline: false },
        { name: 'Requester', value: `<@${requester.id}>` || df, inline: true },
        { name: 'Author', value: song.author || df, inline: true },
        { name: 'Duration', value: f(duration) || df, inline: true },
        { name: `${line} [ Preview ] ${line}`, value: this._shortenURL(song.url) || df, inline: false }
      ],
      image: {
        // Smalles thumbnail
        url: song.thumbnail.thumbnails[0].url
      }
    });

    // Hold message
    await source.send(wrap);
    let timeMsg = await source.send(`:clock1: \`Time Remaining: ${f(duration)}\``);

    // * Move?
    const updateInterval = 5 * 1000;

    // ? Periodically update
    const timer = setInterval(async () => {
      let timeLeft = endTime - Date.now();

      if (timeLeft <= 0 || (this.currentTask && this.currentTask.song !== song)) {
        await timeMsg.edit(`:clock12: \`[Finished Playing]\``);
        clearInterval(timer);

        return;
      }

      await timeMsg.edit(`:clock1: \`Time Remaning: ${f(timeLeft)}\``);
    }, updateInterval);
  }

  async _onFinishPlaying() {
    // ? Destory dispatcher
    if (this.dispatcher) {
      this.dispatcher = null;
    }

    // ? Repeat Task
    // (TASK REPETITION !== SONG REPETITION)
    if (this.repeat && this.currentTask.complete) {
      // Reset task
      this.currentTask.reset();
      this.currentTask.next();

      // Manually Requeue task (avoid refetching data)
      this.queue.unshift(this.currentTask);

      // Emit event
      this.emit('taskRepeat', this.currentTask);

      // Play task
      await this._play(this.currentTask);
      this._log(`Repeating task.`);

      return;
    }

    // ? Inactivity Check
    if (this.free) {
      this._log(`Detected idle player.`);

      // Prevent from staying in channel forever.
      this._inactivityCheck(inactive => {
        if (inactive) {
          this.emit('timeoutLeave');
        }
      });

      return;
    }

    // ? Shuffle Tasks
    if (this.shuffle) {
      this.queue.shuffle();
      this._log(`Shuffled task queue.`);
    }

    // ? Autoplay
    if (this.autoplay) {
      this._log(`Autoplay: Dequeuing next task.`);
      const task = this._dequeue();

      // Play next
      this._log(`Autoplay: Playing dequeued task.`);
      await this._play(task);
    } else {
      this._log(`Autoplay is off. Will not start next song.`);
    }
  }

  /* eslint-disable no-unused-vars */
  async _onSpeakEvent(isPlaying) {
    // ! This is called every stream tick
  }

  /********************
   * Event functions  *
   * ? Connection     *
   ********************/

  async _onConnectionError(err) {
    this._log(`${err.message}`, 'error');
  }

  // ? May trigger after a region change.
  async _onReconnect() {
    this._log('Vulcan voice connection has reconnected.', 'warn');
  }

  /********************
   * Internal methods *
   ********************/

  _log(str, type = 'log') {
    logger[type](`[MusicManager] => [${this.guild.name}] => [${caller.getData().functionName}] => ${str}`);
  }

  _inactivityCheck(cb) {
    this.checks.push(
      setTimeout(() => {
        // If still in after timeout and not playing
        if (this.idle) {
          this.leave();
          cb(true);
        } else {
          cb(false);
        }
      }, this.afkTimeout)
    );

    // Peek
    return this.checks[this.checks.length - 1];
  }

  // TODO: Improve this LMAO
  _URLtoID(url) {
    url = String(url);

    let result = null;

    // Cheat
    this.uiReg1 =
      this.uiReg1 ||
      new RegExp(
        '(?:youtube(?:-nocookie)?.com/(?:[^/\ns]+/S+/|(?:v|e(?:mbed)?)/|S*?[?&]v=)|youtu.be/)([a-zA-Z0-9_-]{11})'
      );

    const attempt1 = url.match(this.uiReg1);

    result = attempt1 && attempt1[1];

    if (result) {
      return result;
    }

    // Cheat
    this.uiReg2 =
      this.uiReg2 ||
      new RegExp(
        '^(?:https?://)?(?:www.)?youtu.?be(?:.com)?.*?(?:v|list)=(.*?)(?:&|$)|^(?:https?://)?(?:www.)?youtu.?be(?:.com)?(?:(?!=).)*/(.*)$'
      );

    const attempt2 = url.match(this.uiReg2);

    result = attempt2 && attempt2[1];

    if (!result) {
      throw new Error(`Could not find youtube id from url: ${url}`);
    }

    return result;
  }

  _isPlaylist(url) {
    // * Improve regex?
    let regExp = /^.*(list=)([^#\&\?]*).*/;
    let match = url.match(regExp);

    if (match && match[2]) {
      return match[2];
    }

    return null;
  }

  _shortenURL(url) {
    const short = `http://youtu.be/`;

    // Start
    let m = url.match('v=');

    if (m) {
      return `${short}${url.substring(m.index + 2)}`;
    }

    m = url.lastIndexOf('/');

    if (m) {
      return `${short}${url.substring(m + 1)}`;
    }

    return url;
  }

  async _loadPlaylistToArray(rurl) {
    // ! Cant have short here?
    // TODO: Improve
    const short = `http://youtu.be/`;
    const base = `http://www.youtube.com/`;
    const str = rurl;
    const split = str.indexOf('watch') === -1 ? str : `${base}playlist?list=${str.split('&list=')[1].split('&t=')[0]}`;

    const res = await got(split);
    const $ = cheerio.load(res.body);
    const thumb = $('tr');

    return thumb.map((_index, el) => `${short}${el.attribs['data-video-id']}`).get();
  }

  /**
   * Prepares a task to be played.
   * Pushes task to Music Manager queue.
   *
   * @param {MusicManager.Task} task The task to be enqueued.
   */
  async _enqueue(task) {
    // Flag - not idle
    this.loading = true;

    // To prepare task
    // * We load task song data on enqueue
    await task.load();

    // Flag & update
    this.loading = false;

    // Push data to queue
    this.queue.push(task);

    // Log
    this._log(`Enqueued a task.`);
  }

  /**
   * Dequeues a task.
   * Tasks may be composed of many songs.
   * * If many songs, shifts internal task song queue.
   *
   * @returns {MusicManager.Task} The task that was dequeued.
   */
  _dequeue() {
    if (this.free) {
      throw new Error('Queue is empty!');
    }

    // Task
    const task = this.queue[0];

    // Pick song from task
    task.next();

    // Dequeue task, if no more songs
    if (task.complete) {
      this.queue.shift();
      this._log('Task marked as complete and shifted');
    }

    // Log
    this._log('Dequeued a task.');

    return task;
  }

  /**
   * Plays a given task.
   * Establishes a connection and stream.
   *
   * @param {MusicManager.Taskl} task The task to play.
   */
  async _play(task) {
    if (!task || !task.song) {
      throw new Error(`Music player tried to played a corrupted or invalid task.`);
    }

    // Create stream
    const stream = await ytdl(
      task.song.url,
      // ? ytdl options (ytdlcd is optimised for discord but uses ytdl options)
      {
        filter: format => ['251'],
        highWaterMark: 1 << 20
      }
    );

    // New dispatcher every new song
    this.dispatcher = null;

    // ! This starts the song
    try {
      this.dispatcher = this.connection.play(stream, {
        bitrate: 'auto', // Use voice channel's bit rate
        passes: 3, // Proportional to bandwidth
        volume: false, // Disallow volume control
        type: 'opus'
      });
    } catch (err) {
      this.destroy(), logger.warn(err);

      return;
    }

    // ? Setup events
    this.dispatcher.on('error', logger.warn);
    this.dispatcher.on('debug', logger.debug);
    this.dispatcher.on('start', this._onStartPlaying.bind(this));
    this.dispatcher.on('speaking', this._onSpeakEvent.bind(this));
    this.dispatcher.on('finish', this._onFinishPlaying.bind(this));
    this.dispatcher.on('volumeChange', this._onVolumeChange.bind(this));

    // ? Update state
    // We are now procesing this task
    this.currentTask = task;

    // Update history
    if (this.history.length > this.maxHistory) {
      this.history = [];
    }

    // History
    this.history.push(task);

    // Log
    this._log(`Playing a task.`);
  }

  /********************
   * External methods *
   *********************/

  /**
   * Creates a new connection to a voice channel.
   * Joins that channel and sets up connection events.
   *
   * @param {*} voiceChannel Voice channel to join.
   */
  async join(voiceChannel) {
    voiceChannel = this.guild.channels.resolve(voiceChannel);

    if (!voiceChannel) {
      throw new Error(`Could not resolve voice channel.`);
    }

    // ? Create connection & join channel
    this.connection = await voiceChannel.join();
    this.connection.on('warn', logger.warn);
    this.connection.on('error', this._onConnectionError.bind(this));
    this.connection.on('reconnecting', this._onReconnect.bind(this));

    // ? Begin inactivity check
    this._inactivityCheck(inactive => {
      if (inactive) {
        this.emit('timeoutLeave');
      }
    });

    // Log
    this._log(`Joined voice channel '${voiceChannel.name}' and set up connection events.`);
  }

  /**
   * Leaves current voice channel.
   * Destroys Music Manager instance.
   */
  async leave() {
    if (!this.connection) {
      throw new Error(`Not connected to a voice channel.`);
    }

    // Send end event
    this.connection.disconnect();

    // Reset the status
    this.destroy();

    // Log
    this._log(`Music manager has left.`);
  }

  /**
   * Resolves a SongResolvable into a valid url.
   *
   * @param {RequestResolvable} request Musica Manager request to resolve
   * @returns {Request} A Music Manager Request
   */
  async resolveRequest(request) {
    request = String(request);

    // In case of id
    if (ytdl.validateID(request)) {
      request = `http://www.youtube.com/watch?v=${request}`;
    }

    // Request type
    let url = null;
    let type = null;

    // ? Resolve request (URL or Playlist or Search & Recurse)
    if (this._isPlaylist(request)) {
      url = request;
      type = MusicManager.Request.YOUTUBE_PLAYLIST;
    } else if (ytdl.validateURL(request)) {
      url = request;
      type = MusicManager.Request.YOUTUBE_VIDEO;
    } else {
      const ytResults = (await ytsr(request)).items;

      if (!ytResults || ytResults.length <= 0) {
        return null;
      }

      // Resolve search
      return this.resolveRequest(ytResults[0].link);
    }

    return new MusicManager.Request(this, url, this._URLtoID(url), type);
  }

  /**
   * Parses a music request.
   * Enqueues request and, if possible, plays the request.
   *
   * @param {RequestResolvable} request The request to be resolved
   * @param {GuildMember} requester The guild member that initiated the request via a discord command
   * @param {TextChannel} source The text channel from which the author made the request
   */
  async request(request, requester, source) {
    source = this.guild.channels.resolve(source);

    if (!source) {
      throw new Error(`Could not resolve channel.`);
    }

    requester = this.guild.members.resolve(requester);

    if (!requester) {
      throw new Error(`Could not resolve requester.`);
    }

    // Notify of request resolving
    const m = await source.send(`:gear: \`Resolving Request...\``);

    // Resolve request
    request = await this.resolveRequest(request);

    // There may be no resolve!
    if (!request) {
      await m.edit(`:gear: \`Found no results for that request! :(\``);
      this._log(`Could not resolve request: ${request}`, 'warn');

      return;
    }

    // Notify of enqueue
    await m.edit(`:gear: \`Processing Request: ${request.id}\``);

    // Generate task
    await this._enqueue(new MusicManager.Task(this, request, requester, source));

    // Notify of completed enqueue
    await m.edit(`:gear: \`Request Processed\``);

    // If idle, dequeue to play a song
    if (this.idle) {
      this._log('Music Player idle, dequeuing task from request.');

      // Dequeue task
      const task = this._dequeue();

      // Play dequeued task
      await this._play(task);
    }

    // Log
    this._log(`Request processed.`);
  }

  async forcePlay(idOrURL, requestChannel, requestAuthor) {
    throw new Error(`Not implemented yet.`);
  }

  pause() {
    if (!this.dispatcher) {
      throw new Error(`Dispatcher not found on pause.`);
    }

    this.shouldPause = true;
    this.dispatcher.pause();

    // Log
    this._log(`Requesting pause. Song will be paused!`);
  }

  resume() {
    if (!this.dispatcher) {
      throw new Error(`Dispatcher not found on resume.`);
    }

    this.shouldPause = false;
    this.dispatcher.resume();

    // Log
    this._log(`Requesting resume. Song will be resumed!`);
  }

  skip(force = false) {
    if (!this.dispatcher) {
      throw new Error(`Dispatcher not found on skip.`);
    }

    // Send end event
    this.dispatcher.end();

    if (force) {
      this.dispatcher.destroy();
    }

    // Log
    this._log(`Skipping current song. Force: ${force}`);
  }

  prune() {
    this.queue = [];

    // Log
    this._log(`Removed all elements from player queue.`);
  }

  purge() {
    if (this.dispatcher) {
      this.dispatcher.end();
    }

    // Reset to defaults
    this.queue = [];
    this.autoplay = true;
    this.repeat = false;
    this.shouldPause = false;
    this.shuffle = false;

    // Log
    this._log(`Reset Music Manager state to defaults.`);
  }

  destroy() {
    // Purge
    this.purge();

    // Clean these up at the end of event loop
    setTimeout(() => {
      this.connection = null;
      this.dispatcher = null;
      this.currentTask = null;
    }, 0);

    // Clear checks
    this.checks.forEach(check => clearTimeout(check));

    // Log
    this._log(`Destroyed Music Manager.`);
  }

  queueString() {
    const escmd = Discord.Util.escapeMarkdown;
    let buildCache = [];

    // Loop through all task lists
    this.queue.forEach((task, i) => {
      task.songs.forEach((song, j) => {
        buildCache.push(`**[${i}][${j}]**: ${escmd(song.name || '(Loading...)')}\n${escmd(String(song.url))}\n`);
      });
    });

    return buildCache.join('\n');
  }
}

MusicManager.Request = class {
  constructor(manager, url, id, type) {
    if (typeof url !== 'string') {
      throw new Error(``);
    }

    this.url = url;
    this.id = id;
    this.type = type;
    this.mnager = manager;
    this.client = manager.client;
  }
};

// Constants for types
MusicManager.Request.YOUTUBE_VIDEO = 1;
MusicManager.Request.YOUTUBE_PLAYLIST = 2;

MusicManager.Task = class {
  constructor(manager, request, requester, source) {
    this.request = request;
    this.requester = requester;
    this.source = source;
    this.manager = manager;
    this.client = manager.client;
    this.songs = [];
    this._counter = -1;
  }

  _log(str, type = 'log') {
    this.manager._log(`[Task] => ${str}`, type);
  }

  async load() {
    let urls = [this.request.url];
    let rmsg = null;
    let i = 1;

    if (this.request.type === MusicManager.Request.YOUTUBE_PLAYLIST) {
      this._log(`Preparing to load playlist.`);
      urls = await this.manager._loadPlaylistToArray(urls[0]);
      rmsg = await this.source.send(`:notepad_spiral: \`Playlist Detected!\``);
    }

    const proms = [];
    const uStep = 5;
    const etime = Math.formatMilliseconds(urls.length * 550);

    for (let url of urls) {
      if (!url) {
        continue;
      }

      const info = await ytdl.getInfo(url);
      const status = info.player_response.playabilityStatus.status;

      if (status !== 'OK') {
        this._log(`Skipped unplayable song. STATUS=${status}`);
        continue;
      }

      this.songs.push({
        url,
        name: info.videoDetails.title || 'Unknown',
        loudness: info.videoDetails.loudnessDb || 0,
        author: info.videoDetails.author || 'Unknown',
        seconds: parseInt(info.videoDetails.lengthSeconds, 10) || 0,
        thumbnail: info.player_response.videoDetails.thumbnail || ''
      });

      // Notify playlist loading
      if ((rmsg && i === urls.length) || i % uStep === 0) {
        proms.push(
          rmsg.edit(`:notepad_spiral: \`Loading Playlist | Song ${i}/${urls.length} | Expected Time: ${etime}\``)
        );
      }

      i++;
      this._log(`Loaded a song: ${url}`);
    }

    await Promise.all(proms);

    // Final update
    if (rmsg) {
      await rmsg.edit(`:notepad_spiral: \`Playlist Loaded | #Songs: ${this.songs.length}\``);
    }

    // Extra status
    if (this.songs.length < urls.length) {
      this.source.send(`:warning: \`Some songs were unreachable!\``);
    }

    return this.songs;
  }

  get complete() {
    return this._counter >= this.songs.length - 1;
  }

  get song() {
    return this.songs[this._counter];
  }

  reset() {
    this._counter = -1;
    this._log(`Task reset called`);
  }

  next() {
    this._counter++;
    this._log(`Next task called.`);
  }
};

module.exports = MusicManager;
