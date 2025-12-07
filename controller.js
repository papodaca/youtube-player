import { Controller } from "@hotwired/stimulus";
import tmi from "tmi.js";

export default class extends Controller {
  static targets = [
    "player", "queueList", "channelInput", "connectionStatus",
    "playPauseIcon", "volumeSlider", "autoplayToggle", "currentVideoInfo",
    "currentThumbnail", "currentTitle", "currentChannel", "queueCount",
    "progressBar", "currentTime", "duration", "youtubeLinkInput", "queueItem"
  ]

  static values = {
    channelName: String,
    autoplay: { type: Boolean, default: false }
  }

  connect() {
    this.queue = []
    this.currentVideo = null
    this.isConnected = false
    this.client = null
    this.autoplay = this.autoplayValue
    this.progressInterval = null
    this.loadState()
    this.setupPlayer()
    this.updateConnectionStatus()
    this.setupFullscreenListeners()

    // Auto-reconnect if channel was previously connected
    if (this.channelNameValue && this.channelNameValue !== 'your_channel_name') {
      this.channelInputTarget.value = this.channelNameValue
      this.connectToChannel()
    }
  }

  setupPlayer() {
    // Create YouTube player if API is already loaded
    if (window.YT && window.YT.Player) {
      this.createPlayer();
    } else {
      // Fallback if API loads after our controller
      window.onYouTubeIframeAPIReady = () => this.createPlayer();
    }
  }

  createPlayer() {
    this.player = new YT.Player('player', {
      height: '100%',
      width: '100%',
      playerVars: {
        'autoplay': 0,
        'controls': 0,
        'rel': 0,
        'showinfo': 0,
        'modestbranding': 1
      },
      events: {
        'onStateChange': this.onPlayerStateChange.bind(this),
        'onReady': this.onPlayerReady.bind(this)
      }
    });
  }

  onPlayerReady(event) {
    // Set volume from saved state or default
    const volume = this.savedVolume || 50
    event.target.setVolume(volume)
    this.volumeSliderTarget.value = volume

    // Load current video if it exists
    if (this.currentVideo) {
      event.target.cueVideoById(this.currentVideo.videoId)
    }

    // Start progress tracking
    this.startProgressTracking();
  }

  onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.ENDED) {
      if (this.autoplay) {
        this.playNext(false) // Auto-play next video when autoplay is enabled
      }
    } else if (event.data === YT.PlayerState.PLAYING) {
      this.updatePlayPauseIcon(true)
      this.startProgressTracking()
    } else if (event.data === YT.PlayerState.PAUSED) {
      this.updatePlayPauseIcon(false)
      this.stopProgressTracking()
    } else if (event.data === YT.PlayerState.BUFFERING) {
      this.stopProgressTracking()
    }
  }

  connectToChannel() {
    const channelName = this.channelInputTarget.value.trim()
    if (!channelName) {
      this.showError('Please enter a channel name')
      return
    }

    this.channelNameValue = channelName
    this.saveState()
    this.connectToTwitch()
  }

  connectToTwitch() {
    if (this.client) {
      this.client.disconnect()
    }

    this.client = new tmi.Client({
      channels: [this.channelNameValue]
    })

    this.client.connect().then(() => {
      this.isConnected = true
      this.updateConnectionStatus()
      this.showSuccess(`Connected to ${this.channelNameValue}`)
    }).catch(error => {
      this.showError(`Failed to connect: ${error.message}`)
      this.isConnected = false
      this.updateConnectionStatus()
    })

    this.client.on('message', (channel, tags, message, self) => {
      if (self) return
      this.processMessage(message, tags)
    })

    this.client.on('disconnected', () => {
      this.isConnected = false
      this.updateConnectionStatus()
    })
  }

  processMessage(message, tags) {
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/
    const match = message.match(youtubeRegex)

    if (match) {
      const videoId = match[1]
      this.addToQueue(videoId, tags.username)
    }
  }

  async addToQueue(videoId, username = null) {
    // Check if video already exists in queue
    if (this.queue.some(item => item.videoId === videoId)) {
      return
    }

    try {
      const videoInfo = await this.fetchVideoInfo(videoId)
      const queueItem = {
        videoId,
        title: videoInfo.title,
        channel: videoInfo.channel,
        thumbnail: videoInfo.thumbnail,
        username,
        addedAt: new Date()
      }

      this.queue.push(queueItem)
      this.updateQueueDisplay()
      this.saveState()

      if (!this.currentVideo) {
        this.playNext(false) // Auto-load first video, don't play if autoplay is disabled
      }
    } catch (error) {
      console.error('Failed to fetch video info:', error)
      // Still add to queue even if info fetch fails
      this.queue.push({
        videoId,
        title: `Video ${videoId}`,
        channel: 'Unknown',
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        username,
        addedAt: new Date()
      })
      this.updateQueueDisplay()
    }
  }

  async fetchVideoInfo(videoId) {
    const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`)
    const data = await response.json()

    return {
      title: data.title || 'Unknown Title',
      channel: data.author_name || 'Unknown Channel',
      thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    }
  }

  updateQueueDisplay() {
    this.queueCountTarget.textContent = `${this.queue.length} items`

    if (this.queue.length === 0) {
      this.queueListTarget.innerHTML = '<p class="text-gray-500 text-center py-4">Queue is empty</p>'
      return
    }

    this.queueListTarget.innerHTML = this.queue.map((item, index) => `
      <div class="bg-gray-700 rounded-lg p-3 flex items-center space-x-3 group hover:bg-gray-600 transition-colors cursor-move"
           data-youtube-player-target="queueItem"
           data-index="${index}"
           draggable="true">
        <div class="icon-grip-vertical w-4 h-4 text-gray-500"></div>
        <a href="https://www.youtube.com/watch?v=${item.videoId}"
           target="_blank"
           rel="noopener noreferrer"
           class="block w-16 h-12 rounded overflow-hidden hover:ring-2 hover:ring-twitch transition-all"
           title="Open video in new tab">
          <img src="${item.thumbnail}" alt="${item.title}" class="w-full h-full object-cover">
        </a>
        <div class="flex-1 min-w-0">
          <h4 class="font-medium text-sm truncate">${item.title}</h4>
          <p class="text-xs text-gray-400">${item.channel}</p>
          ${item.username ? `<p class="text-xs text-twitch">Added by ${item.username}</p>` : ''}
        </div>
        <button data-action="click->youtube-player#removeFromQueue"
                data-index="${index}"
                class="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity">
          <div class="icon-x w-5 h-5"></div>
        </button>
      </div>
    `).join('')

    // Add event listeners to queue items since they're dynamically created
    this.queueItemTargets.forEach(item => {
      item.addEventListener('dragstart', this.dragStart.bind(this))
      item.addEventListener('dragend', this.dragEnd.bind(this))
      item.addEventListener('dragover', this.dragOver.bind(this))
      item.addEventListener('drop', this.drop.bind(this))
    })
  }

  playNext(manual = false) {
    if (this.queue.length === 0) {
      this.currentVideo = null
      this.currentVideoInfoTarget.classList.add('hidden')
      return
    }

    this.currentVideo = this.queue.shift()
    this.updateQueueDisplay()
    this.updateCurrentVideoDisplay()
    this.saveState()

    if (this.player && this.player.loadVideoById) {
      if (manual || this.autoplay) {
        // Manual click or autoplay enabled - use loadVideoById to start playing
        this.player.loadVideoById(this.currentVideo.videoId)
      } else {
        // Autoplay disabled and not manual - use cueVideoById to load but not play
        this.player.cueVideoById(this.currentVideo.videoId)
      }
    }
  }

  playPrevious() {
    // Note: YouTube iframe API doesn't provide a built-in previous functionality
    // This would require maintaining a history of played videos
    this.showInfo('Previous functionality not implemented yet')
  }

  next() {
    this.playNext(true) // Manual next click, always play
  }

  stop() {
    if (!this.player) return

    // Stop the player
    this.player.stopVideo()

    // Clear current video
    this.currentVideo = null
    this.currentVideoInfoTarget.classList.add('hidden')

    // Update play/pause icon to play state
    this.updatePlayPauseIcon(false)

    // Save state
    this.saveState()

    // If queue is empty, perform a full reset to clear the player completely
    if (this.queue.length === 0) {
      this.reset()
    } else if (this.autoplay) {
      // Auto-play next video if autoplay is enabled and queue has items
      this.playNext(false)
    }
  }

  reset() {
    // Destroy and recreate the YouTube player
    if (this.player) {
      this.player.destroy()
      this.player = null
    }

    // Clear queue and current video
    this.queue = []
    this.currentVideo = null

    // Update UI
    this.updateQueueDisplay()
    this.currentVideoInfoTarget.classList.add('hidden')
    this.updatePlayPauseIcon(false)

    // Reset progress bar
    if (this.progressBarTarget) {
      this.progressBarTarget.value = 0
    }
    if (this.currentTimeTarget) {
      this.currentTimeTarget.textContent = '0:00'
    }
    if (this.durationTarget) {
      this.durationTarget.textContent = '0:00'
    }

    // Recreate the player
    setTimeout(() => {
      this.createPlayer()
    }, 100)

    // Save state
    this.saveState()

    this.showSuccess('Player reset successfully')
  }

  togglePlay() {
    if (!this.player) return

    if (this.player.getPlayerState() === YT.PlayerState.PLAYING) {
      this.player.pauseVideo()
    } else {
      this.player.playVideo()
    }
  }

  updatePlayPauseIcon(isPlaying) {
    if (isPlaying) {
      this.playPauseIconTarget.className = 'icon-pause w-5 h-5'
    } else {
      this.playPauseIconTarget.className = 'icon-play w-5 h-5'
    }
  }

  changeVolume() {
    if (!this.player) return
    const volume = this.volumeSliderTarget.value
    this.player.setVolume(volume)
    this.saveState()
  }

  toggleAutoplay() {
    this.autoplay = this.autoplayToggleTarget.checked
    this.saveState()
  }

  updateCurrentVideoDisplay() {
    if (!this.currentVideo) {
      this.currentVideoInfoTarget.classList.add('hidden')
      return
    }

    this.currentVideoInfoTarget.classList.remove('hidden')

    // Make the current thumbnail a link
    this.currentThumbnailTarget.outerHTML = `
      <a href="https://www.youtube.com/watch?v=${this.currentVideo.videoId}"
         target="_blank"
         rel="noopener noreferrer"
         data-youtube-player-target="currentThumbnail"
         class="w-24 h-18 rounded hover:ring-2 hover:ring-twitch transition-all cursor-pointer"
         title="Open video in new tab">
        <img src="${this.currentVideo.thumbnail}" alt="${this.currentVideo.title}" class="w-full h-full rounded object-cover">
      </a>
    `

    this.currentTitleTarget.textContent = this.currentVideo.title
    this.currentChannelTarget.textContent = this.currentVideo.channel
  }

  removeFromQueue(event) {
    const index = parseInt(event.currentTarget.dataset.index)
    this.queue.splice(index, 1)
    this.updateQueueDisplay()
    this.saveState()
  }

  clearQueue() {
    this.queue = []
    this.updateQueueDisplay()
    this.saveState()
  }

  addYoutubeLink() {
    const url = this.youtubeLinkInputTarget.value.trim()
    if (!url) {
      this.showError('Please enter a YouTube URL')
      return
    }

    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/
    const match = url.match(youtubeRegex)

    if (!match) {
      this.showError('Invalid YouTube URL. Please enter a valid YouTube link.')
      return
    }

    const videoId = match[1]
    this.addToQueue(videoId, 'Manual')
    this.youtubeLinkInputTarget.value = ''
    this.showSuccess('YouTube video added to queue!')
  }

  setupFullscreenListeners() {
    document.addEventListener('fullscreenchange', () => {
      const playerContainer = document.getElementById('player')
      if (!document.fullscreenElement) {
        playerContainer.classList.remove('fullscreen-mode')
      }
    })

    document.addEventListener('webkitfullscreenchange', () => {
      const playerContainer = document.getElementById('player')
      if (!document.webkitFullscreenElement) {
        playerContainer.classList.remove('fullscreen-mode')
      }
    })

    document.addEventListener('mozfullscreenchange', () => {
      const playerContainer = document.getElementById('player')
      if (!document.mozFullScreenElement) {
        playerContainer.classList.remove('fullscreen-mode')
      }
    })

    document.addEventListener('MSFullscreenChange', () => {
      const playerContainer = document.getElementById('player')
      if (!document.msFullscreenElement) {
        playerContainer.classList.remove('fullscreen-mode')
      }
    })
  }

  toggleFullscreen() {
    const playerContainer = document.getElementById('player')

    if (!document.fullscreenElement) {
      const requestFullscreen = playerContainer.requestFullscreen ||
        playerContainer.webkitRequestFullscreen ||
        playerContainer.mozRequestFullScreen ||
        playerContainer.msRequestFullscreen

      if (requestFullscreen) {
        requestFullscreen.call(playerContainer).then(() => {
          playerContainer.classList.add('fullscreen-mode')
        }).catch(error => {
          this.showError(`Error attempting to enable fullscreen: ${error.message}`)
        })
      } else {
        this.showError('Fullscreen is not supported by your browser')
      }
    } else {
      const exitFullscreen = document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.mozCancelFullScreen ||
        document.msExitFullscreen

      if (exitFullscreen) {
        exitFullscreen.call(document).catch(error => {
          this.showError(`Error attempting to exit fullscreen: ${error.message}`)
        })
      }
    }
  }

  updateConnectionStatus() {
    if (this.isConnected) {
      this.connectionStatusTarget.textContent = 'Connected'
      this.connectionStatusTarget.className = 'px-2 py-1 rounded text-sm font-medium bg-green-900 text-green-300'
    } else {
      this.connectionStatusTarget.textContent = 'Disconnected'
      this.connectionStatusTarget.className = 'px-2 py-1 rounded text-sm font-medium bg-gray-700 text-gray-300'
    }
  }

  showSuccess(message) {
    this.showNotification(message, 'success')
  }

  showError(message) {
    this.showNotification(message, 'error')
  }

  showInfo(message) {
    this.showNotification(message, 'info')
  }

  startProgressTracking() {
    this.stopProgressTracking() // Clear any existing interval
    this.progressInterval = setInterval(() => {
      this.updateProgress()
    }, 250) // Update 4 times per second for smooth progress
  }

  stopProgressTracking() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval)
      this.progressInterval = null
    }
  }

  updateProgress() {
    if (!this.player) return

    const currentTime = this.player.getCurrentTime()
    const duration = this.player.getDuration()

    if (duration && currentTime >= 0) {
      const progressPercent = (currentTime / duration) * 100
      this.progressBarTarget.value = progressPercent
      this.currentTimeTarget.textContent = this.formatTime(currentTime)
      this.durationTarget.textContent = this.formatTime(duration)
    }
  }

  seekTo(event) {
    if (!this.player) return

    const seekPercent = event.target.value
    const duration = this.player.getDuration()

    if (duration) {
      const seekTime = (seekPercent / 100) * duration
      this.player.seekTo(seekTime, true)
    }
  }

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  dragStart(event) {
    const queueItem = event.target.closest('[data-youtube-player-target="queueItem"]')
    if (!queueItem) return

    this.draggedIndex = parseInt(queueItem.dataset.index)
    queueItem.classList.add('opacity-50')
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/html', queueItem.innerHTML)
  }

  dragEnd(event) {
    const queueItem = event.target.closest('[data-youtube-player-target="queueItem"]')
    if (queueItem) {
      queueItem.classList.remove('opacity-50')
    }

    // Clean up any border styling
    this.queueItemTargets.forEach(item => {
      item.classList.remove('border-t-2', 'border-twitch')
    })

    this.draggedIndex = null
  }

  dragOver(event) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    const draggedOverElement = event.target.closest('[data-youtube-player-target="queueItem"]')
    if (draggedOverElement) {
      // Remove border from all items first
      this.queueItemTargets.forEach(item => {
        item.classList.remove('border-t-2', 'border-twitch')
      })
      // Add border to the current drop target
      draggedOverElement.classList.add('border-t-2', 'border-twitch')
    }
  }

  drop(event) {
    event.preventDefault()

    const dropTarget = event.target.closest('[data-youtube-player-target="queueItem"]')
    if (!dropTarget || this.draggedIndex === null) return

    const dropIndex = parseInt(dropTarget.dataset.index)

    // Remove border styling
    this.queueItemTargets.forEach(item => {
      item.classList.remove('border-t-2', 'border-twitch')
    })

    if (this.draggedIndex !== dropIndex) {
      // Reorder the queue
      const draggedItem = this.queue[this.draggedIndex]
      this.queue.splice(this.draggedIndex, 1)
      this.queue.splice(dropIndex, 0, draggedItem)

      this.updateQueueDisplay()
      this.saveState() // Save the reordered queue to local storage
    }
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div')
    const colors = {
      success: 'bg-green-800 text-green-200',
      error: 'bg-red-800 text-red-200',
      info: 'bg-blue-800 text-blue-200'
    }

    notification.className = `fixed top-4 right-4 ${colors[type]} px-4 py-2 rounded-lg shadow-lg z-50 transition-opacity duration-300`
    notification.textContent = message

    document.body.appendChild(notification)

    setTimeout(() => {
      notification.style.opacity = '0'
      setTimeout(() => notification.remove(), 300)
    }, 3000)
  }

  saveState() {
    const state = {
      queue: this.queue,
      currentVideo: this.currentVideo,
      autoplay: this.autoplay,
      channelName: this.channelNameValue,
      volume: this.volumeSliderTarget?.value || 50
    }
    localStorage.setItem('youtubePlayerState', JSON.stringify(state))
  }

  loadState() {
    try {
      const savedState = localStorage.getItem('youtubePlayerState')
      if (savedState) {
        const state = JSON.parse(savedState)

        // Restore queue
        if (state.queue && Array.isArray(state.queue)) {
          this.queue = state.queue
          this.updateQueueDisplay()
        }

        // Restore current video
        if (state.currentVideo) {
          this.currentVideo = state.currentVideo
          this.updateCurrentVideoDisplay()
        }

        // Restore autoplay setting
        if (typeof state.autoplay === 'boolean') {
          this.autoplay = state.autoplay
          this.autoplayToggleTarget.checked = state.autoplay
        }

        // Restore channel name
        if (state.channelName) {
          this.channelNameValue = state.channelName
          this.channelInputTarget.value = state.channelName
        }

        // Restore volume (will be applied after player is ready)
        if (state.volume) {
          this.savedVolume = state.volume
        }
      }
    } catch (error) {
      console.error('Failed to load state from localStorage:', error)
    }
  }
}