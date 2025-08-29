// Application State
let appState = {
  currentUser: null,
  users: [],
  videos: [],
  selectedVideo: null,
  showUpload: false,
  showSignup: false,
  showLogin: false,
  searchQuery: '',
  loginError: ''
};

// Persistence helpers for UI/session
function saveSession() {
  try {
    const payload = {
      currentUser: appState.currentUser,
      selectedVideoId: appState.selectedVideo?.id || null,
      showUpload: appState.showUpload,
      showSignup: appState.showSignup,
      showLogin: appState.showLogin,
      searchQuery: appState.searchQuery
    };
    localStorage.setItem('streamhub_session', JSON.stringify(payload));
  } catch (_) {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem('streamhub_session');
    if (!raw) return;
    const data = JSON.parse(raw);
    appState.currentUser = data.currentUser || null;
    appState.showUpload = !!data.showUpload;
    appState.showSignup = !!data.showSignup;
    appState.showLogin = !!data.showLogin;
    appState.searchQuery = data.searchQuery || '';
    // selectedVideo restored after videos are fetched
    if (data.selectedVideoId) {
      appState._pendingSelectedVideoId = data.selectedVideoId;
    }
  } catch (_) {}
}

// Utility Functions
function formatViews(views) {
  if (views >= 1000000) {
    return `${(views / 1000000).toFixed(1)}M`;
  } else if (views >= 1000) {
    return `${(views / 1000).toFixed(1)}K`;
  }
  return views.toString();
}

function createElement(tag, className = '', content = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.innerHTML = content;
  return element;
}

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Backend API base (for persistence)
// Use local API in dev; fall back to localhost if origin is file:// or empty
let API_BASE = '';
if (typeof window !== 'undefined') {
  const origin = window.location.origin || '';
  if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
    API_BASE = 'http://localhost:3001';
  } else if (origin === 'null' || origin === '' || origin.startsWith('file://')) {
    API_BASE = 'http://localhost:3001';
  } else {
    API_BASE = origin;
  }
}

async function fetchPersistedVideos() {
  try {
    console.log('Fetching videos from:', `${API_BASE}/videos`);
    const res = await fetch(`${API_BASE}/videos`);
    if (!res.ok) {
      console.error('Error fetching videos:', res.status, res.statusText);
      return;
    }
    const data = await res.json();
    console.log('Received videos data:', data);
    if (Array.isArray(data.videos)) {
      appState.videos = data.videos;
      console.log('Updated videos in appState:', appState.videos.length);
    }
  } catch (err) {
    console.error('Error fetching videos:', err);
  }
}

async function fetchPersistedUsers() {
  try {
    const res = await fetch(`${API_BASE}/local/users`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.users)) {
      appState.users = data.users;
    }
  } catch (err) {
    // ignore
  }
}

async function persistLocalVideo(video) {
  try {
    // Add timestamp and ensure all required fields
    const videoData = {
      ...video,
      uploadDate: new Date().toISOString(),
      views: 0,
      rating: 0,
      totalRatings: 0,
      comments: [],
      // Ensure the video URL is properly formatted
      videoUrl: video.videoUrl.startsWith('http') ? video.videoUrl : `${API_BASE}${video.videoUrl}`
    };

    const res = await fetch(`${API_BASE}/local/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(videoData)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.video || null;
  } catch (err) {
    console.error('Error persisting video:', err);
    return null;
  }
}

async function uploadFileToBackend(file) {
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/local/upload`, { method: 'POST', body: form });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.url || null;
  } catch (err) {
    return null;
  }
}

async function seedLocalVideosForCurrentUser(count = 5) {
  if (!appState.currentUser) return;
  const titlesA = ['Incredible', 'Ultimate', 'Beginner\'s', 'Advanced', 'Epic'];
  const titlesB = ['Nature', 'Architecture', 'Coding', 'Music', 'Travel', 'Food', 'Sports'];
  const titlesC = ['Guide', 'Tour', 'Tutorial', 'Highlights', 'Showcase'];
  const genres = ['Documentary', 'Educational', 'Technology', 'Entertainment', 'Music', 'Sports', 'Travel', 'Food'];
  const ratings = ['G', 'PG', 'PG-13', 'R'];

  const now = new Date();
  const created = [];
  for (let i = 1; i <= count; i++) {
    const title = `${getRandomItem(titlesA)} ${getRandomItem(titlesB)} ${getRandomItem(titlesC)}`;
    const description = 'Locally available demo video seeded for quick testing.';
    const genre = getRandomItem(genres);
    const ageRating = getRandomItem(ratings);
    const day = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
    const payload = {
      title,
      description,
      genre,
      ageRating,
      uploadedBy: appState.currentUser.username,
      videoUrl: `${API_BASE}/videos/demo-${i}.mp4`,
      thumbnail: `${API_BASE}/videos/thumb-${i}.jpg`
    };
    const saved = await persistLocalVideo(payload);
    if (saved) created.push(saved);
  }
  if (created.length) appState.videos.unshift(...created);
}

function showElement(id) {
  document.getElementById(id).classList.remove('hidden');
}

function hideElement(id) {
  document.getElementById(id).classList.add('hidden');
}

function clearErrors() {
  const errorElements = document.querySelectorAll('.error-text');
  errorElements.forEach(el => el.textContent = '');
}

// Authentication Functions
function handleLogin(credentials) {
  appState.loginError = '';
  
  const user = appState.users.find(u => 
    (u.email.toLowerCase() === credentials.emailOrUsername.toLowerCase() || 
     u.username.toLowerCase() === credentials.emailOrUsername.toLowerCase())
  );

  if (!user) {
    appState.loginError = 'User not found with this email/username';
    updateErrorMessage();
    return;
  }

  if (user.password !== credentials.password) {
    appState.loginError = 'Invalid password';
    updateErrorMessage();
    return;
  }

  appState.currentUser = user;
  appState.showLogin = false;
  appState.showSignup = false;
  appState.showUpload = false;
  
  // Seed local demo videos if none exist yet
  if (appState.videos.length === 0) {
    seedLocalVideosForCurrentUser(5).then(updateUI);
  }
  
  updateUI();
}

function handleLogout() {
  appState.currentUser = null;
  appState.selectedVideo = null;
  appState.showUpload = false;
  appState.showSignup = false;
  appState.showLogin = false;
  appState.loginError = '';
  
  updateUI();
  saveSession();
}

function handleSignup(userData) {
  // Persist signup to backend so it survives refresh
  return fetch(`${API_BASE}/local/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: userData.username,
      email: userData.email,
      password: userData.password,
      role: userData.role
    })
  })
  .then(async (res) => {
    if (res.status === 409) {
      return { ok: false, reason: 'exists' };
    }
    if (!res.ok) {
      return { ok: false, reason: 'other' };
    }
    const data = await res.json();
    if (data?.user) {
      appState.users.push(data.user);
      appState.currentUser = data.user;
      appState.showSignup = false;
      if (data.user.role === 'streamer' && appState.videos.length === 0) {
        seedLocalVideosForCurrentUser(5);
      }
      updateUI();
      return { ok: true };
    }
    return { ok: false, reason: 'other' };
  })
  .catch(() => ({ ok: false, reason: 'network' }));
}

// Video Functions
function handleVideoUpload(videoData) {
  console.log('Starting video upload with data:', videoData);
  if (!appState.currentUser || appState.currentUser.role !== 'streamer') {
    console.log('Upload rejected: User not authenticated or not a streamer');
    return;
  }

  // 1) Upload file to backend to get a persisted URL
  console.log('Uploading file to backend...');
  uploadFileToBackend(videoData.videoFile)
    .then(async (url) => {
      console.log('Got URL from backend:', url);
      if (!url) {
        console.error('Failed to get URL from backend');
        return null;
      }
      // 2) Persist video metadata in backend KV
      const payload = {
        title: videoData.title,
        description: videoData.description,
        genre: videoData.genre,
        ageRating: videoData.ageRating,
        uploadedBy: appState.currentUser.username,
        videoUrl: `${API_BASE}${url}`,
        thumbnail: videoData.thumbnail
      };
      console.log('Persisting video with payload:', payload);
      return persistLocalVideo(payload);
    })
    .then((saved) => {
      if (saved) {
        console.log('Video saved successfully:', saved);
        appState.videos.unshift(saved);
        appState.showUpload = false;
        fetchPersistedVideos().then(() => {  // Refresh the videos list
          console.log('Videos refreshed, current count:', appState.videos.length);
          updateUI();
        });
      } else {
        console.error('Failed to save video');
      }
    })
    .catch((error) => {
      console.error('Error during video upload:', error);
    });
}

function handleVideoView(videoId) {
  const video = appState.videos.find(v => v.id === videoId);
  if (video) {
    video.views += 1;
    if (appState.selectedVideo && appState.selectedVideo.id === videoId) {
      appState.selectedVideo.views += 1;
    }
    updatePlatformStats();
  }
}

function handleRatingChange(videoId, rating) {
  if (!appState.currentUser || appState.currentUser.role !== 'viewer') return;

  const video = appState.videos.find(v => v.id === videoId);
  if (video) {
    const newTotalRatings = video.totalRatings + 1;
    const newRating = ((video.rating * video.totalRatings) + rating) / newTotalRatings;
    video.rating = newRating;
    video.totalRatings = newTotalRatings;
    
    if (appState.selectedVideo && appState.selectedVideo.id === videoId) {
      appState.selectedVideo.rating = newRating;
      appState.selectedVideo.totalRatings = newTotalRatings;
      renderVideoPlayer();
    }
    
    updatePlatformStats();
  }
}

function handleCommentAdd(videoId, comment) {
  if (!appState.currentUser) return;

  const newComment = {
    id: Date.now().toString(),
    userId: appState.currentUser.id,
    username: appState.currentUser.username,
    content: comment,
    timestamp: 'just now'
  };

  const video = appState.videos.find(v => v.id === videoId);
  if (video) {
    video.comments.unshift(newComment);
    
    if (appState.selectedVideo && appState.selectedVideo.id === videoId) {
      appState.selectedVideo.comments.unshift(newComment);
      renderVideoPlayer();
    }
  }
}

// UI Rendering Functions
function renderHeader() {
  const headerActions = document.getElementById('headerActions');
  headerActions.innerHTML = '';

  if (appState.currentUser) {
    // Upload button for streamers
    if (appState.currentUser.role === 'streamer') {
      const uploadBtn = createElement('button', 
        `btn ${appState.showUpload ? 'btn-primary' : 'btn-outline'} btn-sm`,
        '<i class="fas fa-upload"></i> Upload Video'
      );
      uploadBtn.onclick = () => toggleUpload();
      headerActions.appendChild(uploadBtn);
    }

    // User info
    const userInfo = createElement('div', 'user-info');
    
    const avatar = createElement('div', 'avatar', appState.currentUser.username[0].toUpperCase());
    const userDetails = createElement('div', 'user-details');
    
    const username = createElement('span', 'username', appState.currentUser.username);
    const badge = createElement('div', 
      `user-badge ${appState.currentUser.role}`,
      `<i class="fas fa-${appState.currentUser.role === 'streamer' ? 'video' : 'play'}"></i> ${appState.currentUser.role === 'streamer' ? 'Streamer' : 'Viewer'}`
    );
    
    userDetails.appendChild(username);
    userDetails.appendChild(badge);
    
    const logoutBtn = createElement('button', 'btn btn-ghost btn-sm', '<i class="fas fa-sign-out-alt"></i>');
    logoutBtn.onclick = handleLogout;
    
    userInfo.appendChild(avatar);
    userInfo.appendChild(userDetails);
    userInfo.appendChild(logoutBtn);
    headerActions.appendChild(userInfo);
  } else {
    // Login/Signup buttons
    const signupBtn = createElement('button', 'btn btn-outline btn-sm', '<i class="fas fa-user-plus"></i> Join Now');
    signupBtn.onclick = () => toggleSignup();
    
    const loginBtn = createElement('button', 'btn btn-primary btn-sm', '<i class="fas fa-sign-in-alt"></i> Login');
    loginBtn.onclick = () => toggleLogin();
    
    headerActions.appendChild(signupBtn);
    headerActions.appendChild(loginBtn);
  }
  // Persist UI/session on each render
  saveSession();
}

function renderVideoGrid() {
  console.log('Starting renderVideoGrid');
  const videoGrid = document.getElementById('videoGrid');
  console.log('Current app state videos:', appState.videos);
  const filteredVideos = getFilteredVideos();
  console.log('Filtered videos:', filteredVideos);
  
  const latestVideos = [...filteredVideos].sort((a, b) => 
    new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
  );
  console.log('Sorted videos:', latestVideos);

  videoGrid.innerHTML = '';

  if (latestVideos.length === 0) {
    videoGrid.innerHTML = '<div class="comment-empty">No videos found.</div>';
    console.log('No videos to display');
    return;
  }

  console.log('Displaying videos:', latestVideos);

  latestVideos.forEach(video => {
    const videoCard = createElement('div', 'video-card');
    videoCard.onclick = () => selectVideo(video);
    
    videoCard.innerHTML = `
      <div class="video-thumbnail">
        <img src="${video.thumbnail}" alt="${video.title}">
        <div class="view-count">
          <i class="fas fa-eye"></i>
          ${formatViews(video.views)}
        </div>
      </div>
      <div class="video-info">
        <div class="video-header">
          <h3 class="video-title">${video.title}</h3>
          <span class="age-rating">${video.ageRating}</span>
        </div>
        <p class="video-description">${video.description}</p>
        <div class="video-meta">
          <span class="genre-badge">${video.genre}</span>
          <span class="publisher">${video.publisher}</span>
        </div>
        <div class="video-footer">
          <span class="streamer-name">By ${video.uploadedBy}</span>
          <div class="video-stats">
            <div class="stat-item">
              <i class="fas fa-star"></i>
              <span>${video.rating.toFixed(1)}</span>
            </div>
            <div class="stat-item">
              <i class="fas fa-comment"></i>
              <span>${video.comments.length}</span>
            </div>
          </div>
        </div>
      </div>
    `;
    
    videoGrid.appendChild(videoCard);
  });
}

function renderVideoPlayer() {
  if (!appState.selectedVideo) return;
  
  const video = appState.selectedVideo;
  const videoPlayerContent = document.getElementById('videoPlayerContent');
  
  // Track view
  handleVideoView(video.id);
  
  videoPlayerContent.innerHTML = `
    <div class="video-player-card">
      <div class="video-container">
        <video class="video-element" controls poster="${video.thumbnail}">
          <source src="${video.videoUrl}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
      </div>
      
      <div class="video-details">
        <div class="video-header-full">
          <div class="video-main-info">
            <div class="video-title-full">
              ${video.title}
              <span class="age-rating">${video.ageRating}</span>
            </div>
            
            <div class="video-subtitle">
              <div class="subtitle-item views">
                <i class="fas fa-eye"></i>
                <span>${formatViews(video.views)} views</span>
              </div>
              <div class="subtitle-item">
                <i class="fas fa-calendar"></i>
                <span>${video.uploadDate}</span>
              </div>
              <span class="genre-badge">${video.genre}</span>
            </div>
            
            <p class="video-description-full">${video.description}</p>
            
            <div class="video-credits">
              <div class="credit-item">Streamer: <span class="streamer-name">${video.uploadedBy}</span></div>
              <div class="credit-item">Publisher: ${video.publisher}</div>
              <div class="credit-item">Producer: ${video.producer}</div>
            </div>
          </div>
          
          <div class="rating-badge">
            <i class="fas fa-star"></i>
            ${video.rating.toFixed(1)} (${video.totalRatings} ratings)
          </div>
        </div>

        ${appState.currentUser && appState.currentUser.role === 'viewer' ? `
          <div class="video-rating-section">
            <h4 class="rating-title">Rate this video:</h4>
            <div class="star-rating" id="starRating">
              ${[1, 2, 3, 4, 5].map(star => `
                <button class="star-btn" data-rating="${star}">
                  <i class="fas fa-star"></i>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="comments-section">
          <h3 class="comments-title">
            Comments (${video.comments.length})
            <span class="status-dot"></span>
          </h3>

          ${appState.currentUser ? `
            <div class="comment-form">
              <div class="avatar">${appState.currentUser.username[0].toUpperCase()}</div>
              <div class="comment-input-group">
                <textarea id="commentTextarea" class="comment-textarea" placeholder="Add a comment..."></textarea>
                <button id="submitComment" class="btn btn-primary btn-sm">
                  <i class="fas fa-paper-plane"></i>
                  Post Comment
                </button>
              </div>
            </div>
          ` : `
            <div class="comment-login-prompt">
              Please join StreamHub to comment on videos.
            </div>
          `}

          <div class="comments-list">
            ${video.comments.length === 0 ? 
              '<div class="comment-empty">No comments yet. Be the first to share your thoughts!</div>' :
              video.comments.map(comment => `
                <div class="comment-card">
                  <div class="comment-content">
                    <div class="avatar">${comment.username[0].toUpperCase()}</div>
                    <div class="comment-body">
                      <div class="comment-header">
                        <span class="comment-author">${comment.username}</span>
                        <span class="comment-time">${comment.timestamp}</span>
                      </div>
                      <p class="comment-text">${comment.content}</p>
                    </div>
                  </div>
                </div>
              `).join('')
            }
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Add event listeners for rating
  if (appState.currentUser && appState.currentUser.role === 'viewer') {
    const starButtons = document.querySelectorAll('.star-btn');
    starButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const rating = parseInt(e.currentTarget.dataset.rating);
        handleRatingChange(video.id, rating);
        
        // Update star display
        starButtons.forEach((star, index) => {
          const icon = star.querySelector('i');
          if (index < rating) {
            icon.classList.add('active');
          } else {
            icon.classList.remove('active');
          }
        });
      });
      
      btn.addEventListener('mouseenter', (e) => {
        const rating = parseInt(e.currentTarget.dataset.rating);
        starButtons.forEach((star, index) => {
          const icon = star.querySelector('i');
          if (index < rating) {
            icon.style.color = '#fde047';
          } else {
            icon.style.color = '#6b7280';
          }
        });
      });
      
      btn.addEventListener('mouseleave', () => {
        starButtons.forEach(star => {
          const icon = star.querySelector('i');
          if (icon.classList.contains('active')) {
            icon.style.color = '#fbbf24';
          } else {
            icon.style.color = '#6b7280';
          }
        });
      });
    });
  }
  
  // Add event listener for comment submission
  const submitCommentBtn = document.getElementById('submitComment');
  if (submitCommentBtn) {
    submitCommentBtn.addEventListener('click', () => {
      const textarea = document.getElementById('commentTextarea');
      const comment = textarea.value.trim();
      if (comment) {
        handleCommentAdd(video.id, comment);
        textarea.value = '';
      }
    });
  }
}

function updatePlatformStats() {
  const platformStats = document.getElementById('platformStats');
  const totalViews = appState.videos.reduce((sum, v) => sum + v.views, 0);
  const totalRatings = appState.videos.reduce((sum, v) => sum + v.totalRatings, 0);
  const streamers = appState.users.filter(u => u.role === 'streamer').length;
  const viewers = appState.users.filter(u => u.role === 'viewer').length;
  
  platformStats.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">Total Videos</span>
      <span class="stat-value">${appState.videos.length}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Streamers</span>
      <span class="stat-value">${streamers}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Viewers</span>
      <span class="stat-value">${viewers}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Total Views</span>
      <span class="stat-value">${formatViews(totalViews)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Total Ratings</span>
      <span class="stat-value">${totalRatings}</span>
    </div>
  `;
}

function updateWelcomeMessage() {
  const welcomeMessage = document.getElementById('welcomeMessage');
  if (appState.currentUser) {
    const roleMessage = appState.currentUser.role === 'streamer' 
      ? 'Upload and share your amazing content with the world.'
      : 'Discover incredible videos from talented streamers.';
    welcomeMessage.textContent = `Welcome ${appState.currentUser.username}! ${roleMessage}`;
  } else {
    welcomeMessage.textContent = 'Discover amazing video content. Join as a viewer or streamer to get started.';
  }
}

function updateSearchResults() {
  const searchResults = document.getElementById('searchResults');
  if (appState.searchQuery) {
    const filteredVideos = getFilteredVideos();
    searchResults.innerHTML = `<p>Found ${filteredVideos.length} videos for "${appState.searchQuery}"</p>`;
    searchResults.classList.remove('hidden');
  } else {
    searchResults.classList.add('hidden');
  }
}

function updateErrorMessage() {
  const errorMessage = document.getElementById('errorMessage');
  if (appState.loginError) {
    errorMessage.textContent = appState.loginError;
    errorMessage.classList.remove('hidden');
  } else {
    errorMessage.classList.add('hidden');
  }
}

function getFilteredVideos() {
  return appState.videos.filter(video =>
    video.title.toLowerCase().includes(appState.searchQuery.toLowerCase()) ||
    video.description.toLowerCase().includes(appState.searchQuery.toLowerCase()) ||
    video.genre.toLowerCase().includes(appState.searchQuery.toLowerCase()) ||
    video.uploadedBy.toLowerCase().includes(appState.searchQuery.toLowerCase())
  );
}

// UI Control Functions
function selectVideo(video) {
  appState.selectedVideo = video;
  updateUI();
  saveSession();
}

function goHome() {
  appState.selectedVideo = null;
  appState.showUpload = false;
  appState.showSignup = false;
  appState.showLogin = false;
  appState.searchQuery = '';
  document.getElementById('searchInput').value = '';
  updateUI();
  saveSession();
}

function toggleSignup() {
  appState.showSignup = !appState.showSignup;
  appState.showLogin = false;
  updateUI();
  saveSession();
}

function toggleLogin() {
  appState.showLogin = !appState.showLogin;
  appState.showSignup = false;
  appState.loginError = '';
  updateUI();
  saveSession();
}

function toggleUpload() {
  appState.showUpload = !appState.showUpload;
  updateUI();
  saveSession();
}

function updateUI() {
  // Show/hide main sections
  if (appState.selectedVideo) {
    showElement('videoPlayer');
    hideElement('mainDashboard');
  } else {
    hideElement('videoPlayer');
    showElement('mainDashboard');
  }
  
  // Show/hide forms
  if (appState.showSignup && !appState.currentUser) {
    showElement('signupForm');
  } else {
    hideElement('signupForm');
  }
  
  if (appState.showLogin && !appState.currentUser) {
    showElement('loginForm');
  } else {
    hideElement('loginForm');
  }
  
  if (appState.showUpload && appState.currentUser && appState.currentUser.role === 'streamer') {
    showElement('uploadForm');
  } else {
    hideElement('uploadForm');
  }
  
  // Update UI components
  renderHeader();
  updateWelcomeMessage();
  updatePlatformStats();
  updateSearchResults();
  updateErrorMessage();
  
  if (appState.selectedVideo) {
    renderVideoPlayer();
  } else {
    renderVideoGrid();
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', function() {
  // Home button
  document.getElementById('homeBtn').addEventListener('click', goHome);
  
  // Back to videos button
  document.getElementById('backToVideos').addEventListener('click', () => {
    appState.selectedVideo = null;
    updateUI();
    saveSession();
  });
  
  // Search input
  document.getElementById('searchInput').addEventListener('input', (e) => {
    appState.searchQuery = e.target.value;
    updateSearchResults();
    renderVideoGrid();
    saveSession();
  });
  
  // Signup form
  document.getElementById('closeSignup').addEventListener('click', () => {
    appState.showSignup = false;
    updateUI();
  });
  
  document.getElementById('cancelSignup').addEventListener('click', () => {
    appState.showSignup = false;
    updateUI();
  });
  
  document.getElementById('signupPasswordToggle').addEventListener('click', () => {
    const passwordInput = document.getElementById('signupPassword');
    const icon = document.querySelector('#signupPasswordToggle i');
    
    if (passwordInput.type === 'password') {
      passwordInput.type = 'text';
      icon.className = 'fas fa-eye-slash';
    } else {
      passwordInput.type = 'password';
      icon.className = 'fas fa-eye';
    }
  });
  
  const pwcToggle = document.getElementById('signupPasswordConfirmToggle');
  if (pwcToggle) {
    pwcToggle.addEventListener('click', () => {
      const passwordInput = document.getElementById('signupPasswordConfirm');
      const icon = document.querySelector('#signupPasswordConfirmToggle i');
      if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        icon.className = 'fas fa-eye-slash';
      } else {
        passwordInput.type = 'password';
        icon.className = 'fas fa-eye';
      }
    });
  }
  
  document.getElementById('signupFormElement').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    
    const username = document.getElementById('signupUsername').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const role = document.querySelector('input[name="signupRole"]:checked').value;
    
    // Validation
    let hasErrors = false;
    
    if (!username || username.length < 3) {
      document.getElementById('signupUsernameError').textContent = 'Username must be at least 3 characters';
      hasErrors = true;
    }
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('signupEmailError').textContent = 'Please enter a valid email address';
      hasErrors = true;
    }
    const passwordConfirm = document.getElementById('signupPasswordConfirm').value;
    if (!passwordConfirm) {
      document.getElementById('signupPasswordConfirmError').textContent = 'Please re-enter your password';
      hasErrors = true;
    } else if (password && passwordConfirm && password !== passwordConfirm) {
      document.getElementById('signupPasswordConfirmError').textContent = 'Passwords do not match';
      hasErrors = true;
    }
    
    if (!password || password.length < 6) {
      document.getElementById('signupPasswordError').textContent = 'Password must be at least 6 characters';
      hasErrors = true;
    }
    
    if (hasErrors) return;
    
    // Submit
    document.getElementById('signupBtnText').textContent = 'Creating Account...';
    
    try {
      const result = await handleSignup({ username, email, password, role });
      if (!result?.ok) {
        if (result?.reason === 'exists') {
          document.getElementById('signupUsernameError').textContent = 'Username or email already exists';
        } else {
          document.getElementById('signupUsernameError').textContent = 'Failed to create user. Please try again';
        }
      } else {
        await fetchPersistedUsers();
      }
    } finally {
      document.getElementById('signupBtnText').textContent = 'Join StreamHub';
    }
  });
  
  // Login form
  document.getElementById('closeLogin').addEventListener('click', () => {
    appState.showLogin = false;
    updateUI();
  });
  
  document.getElementById('cancelLogin').addEventListener('click', () => {
    appState.showLogin = false;
    updateUI();
  });
  
  document.getElementById('loginPasswordToggle').addEventListener('click', () => {
    const passwordInput = document.getElementById('loginPassword');
    const icon = document.querySelector('#loginPasswordToggle i');
    
    if (passwordInput.type === 'password') {
      passwordInput.type = 'text';
      icon.className = 'fas fa-eye-slash';
    } else {
      passwordInput.type = 'password';
      icon.className = 'fas fa-eye';
    }
  });
  
  document.getElementById('loginFormElement').addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    
    const emailOrUsername = document.getElementById('loginEmailUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    // Validation
    let hasErrors = false;
    
    if (!emailOrUsername) {
      document.getElementById('loginEmailUsernameError').textContent = 'Email or username is required';
      hasErrors = true;
    }
    
    if (!password) {
      document.getElementById('loginPasswordError').textContent = 'Password is required';
      hasErrors = true;
    }
    
    if (hasErrors) return;
    
    // Submit
    document.getElementById('loginBtnText').textContent = 'Logging in...';
    
    setTimeout(() => {
      handleLogin({ emailOrUsername, password });
      document.getElementById('loginBtnText').textContent = 'Login';
    }, 1000);
  });
  
  // Upload form
  document.getElementById('closeUpload').addEventListener('click', () => {
    appState.showUpload = false;
    updateUI();
  });
  
  document.getElementById('uploadVideo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const info = document.getElementById('uploadVideoInfo');
    
    if (file) {
      const sizeInMB = (file.size / 1024 / 1024).toFixed(2);
      info.textContent = `Selected: ${file.name} (${sizeInMB} MB)`;
      info.classList.remove('hidden');
    } else {
      info.classList.add('hidden');
    }
  });
  
  document.getElementById('uploadFormElement').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const title = document.getElementById('uploadTitle').value.trim();
    const description = document.getElementById('uploadDescription').value.trim();
    const genre = document.getElementById('uploadGenre').value;
    const ageRating = document.getElementById('uploadAgeRating').value;
    const videoFile = document.getElementById('uploadVideo').files[0];
    const thumbnail = document.getElementById('uploadThumbnail').value.trim();
    
    if (!title || !description || !genre || !videoFile) return;
    
    document.getElementById('uploadBtnText').textContent = 'Uploading...';
    
    setTimeout(() => {
      handleVideoUpload({
        title,
        description,
        genre,
        ageRating,
        videoFile,
        thumbnail
      });
      
      // Reset form
      document.getElementById('uploadFormElement').reset();
      document.getElementById('uploadVideoInfo').classList.add('hidden');
      document.getElementById('uploadBtnText').textContent = 'Upload Video';
    }, 2000);
  });
  
  // Restore session/UI state first
  loadSession();
  // Initial data load from backend so refresh retains state
  const loadData = async () => {
    try {
      await Promise.all([fetchPersistedUsers(), fetchPersistedVideos()]);
      // Re-select video if it exists
      if (appState._pendingSelectedVideoId) {
        const vid = appState.videos.find(v => v.id === appState._pendingSelectedVideoId);
        if (vid) appState.selectedVideo = vid;
        delete appState._pendingSelectedVideoId;
      }
      console.log('Loaded videos:', appState.videos.length);
      updateUI();
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };
  loadData();
  // Expose a helper to seed videos on demand
  window.seedDemoVideos = () => { seedLocalVideosForCurrentUser(5).then(updateUI); };
});