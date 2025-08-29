import { Hono } from 'hono';
import fs from 'fs/promises';
import path from 'path';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import * as kv from './kv-store.js';

// Load environment variables
dotenv.config();

const app = new Hono();

// Add CORS headers
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', '*');
  
  if (c.req.method === 'OPTIONS') {
    return c.text('', 204);
  }
  
  await next();
});

// Logger middleware
app.use('*', async (c, next) => {
  console.log(`${c.req.method} ${c.req.url.pathname}`);
  try {
    await next();
  } catch (err) {
    console.error('Request error:', err);
    throw err;
  }
});

// Serve local media files from /videos with proper headers
app.use('/videos/*', async (c) => {
  try {
    const filePath = '.' + c.req.url.pathname;
    const stat = await fs.stat(filePath);
    
    // Add headers for video streaming
    c.header('Accept-Ranges', 'bytes');
    c.header('Content-Type', 'video/mp4');
    c.header('Content-Length', stat.size.toString());
    
    const content = await fs.readFile(filePath);
    return c.body(content);
  } catch (error) {
    console.error('Error serving video:', error);
    return c.text('Video not found', 404);
  }
});

// Create Supabase client (guard when env vars are missing)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && supabaseServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

// Auth middleware for protected routes
const requireAuth = async (c, next) => {
  if (!supabase) {
    return c.json({ error: 'Auth not configured on server' }, 503);
  }
  const accessToken = c.req.header('Authorization')?.split(' ')[1];
  if (!accessToken) {
    return c.json({ error: 'Unauthorized - No token provided' }, 401);
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (error || !user) {
      return c.json({ error: 'Unauthorized - Invalid token' }, 401);
    }
    c.set('user', user);
    await next();
  } catch (error) {
    console.log('Auth error:', error);
    return c.json({ error: 'Unauthorized - Auth verification failed' }, 401);
  }
};

// Initialize storage buckets on startup
const initializeBuckets = async () => {
  if (!supabase) {
    console.log('Skipping bucket initialization: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    
    const videoBucketName = 'streamhub-videos';
    const videoBucketExists = buckets?.some(bucket => bucket.name === videoBucketName);
    if (!videoBucketExists) {
      const { error } = await supabase.storage.createBucket(videoBucketName, {
        public: false,
        allowedMimeTypes: ['video/*'],
        fileSizeLimit: 100 * 1024 * 1024 // 100MB
      });
      if (error) {
        console.log('Error creating video bucket:', error);
      } else {
        console.log('Video bucket created successfully');
      }
    }

    const thumbnailBucketName = 'streamhub-thumbnails';
    const thumbnailBucketExists = buckets?.some(bucket => bucket.name === thumbnailBucketName);
    if (!thumbnailBucketExists) {
      const { error } = await supabase.storage.createBucket(thumbnailBucketName, {
        public: true,
        allowedMimeTypes: ['image/*'],
        fileSizeLimit: 5 * 1024 * 1024 // 5MB
      });
      if (error) {
        console.log('Error creating thumbnail bucket:', error);
      } else {
        console.log('Thumbnail bucket created successfully');
      }
    }
  } catch (error) {
    console.log('Error initializing buckets:', error);
  }
};

// Initialize buckets
initializeBuckets();

// Seed a default local creator if not present (no Supabase required)
const seedDefaultCreator = async () => {
  try {
    const usernameKey = 'user:username:ade';
    const existing = await kv.get(usernameKey);
    if (existing) return;

    const id = uuidv4();
    const userData = {
      id,
      username: 'ade',
      email: 'ade@dayo.com',
      password: 'Password123',
      role: 'streamer',
      created_at: new Date().toISOString()
    };

    await kv.set(`user:${id}`, userData);
    await kv.set(usernameKey, id);
    await kv.set('user:email:ade@dayo.com', id);
    console.log('Seeded default creator user: ade');
  } catch (err) {
    console.log('Error seeding default creator:', err);
  }
};

seedDefaultCreator();

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// User signup
app.post('/auth/signup', async (c) => {
  try {
    const { username, email, password, role } = await c.req.json();
    
    // Validate input
    if (!username || !email || !password || !role) {
      return c.json({ error: 'Missing required fields' }, 400);
    }
    
    if (!['viewer', 'streamer'].includes(role)) {
      return c.json({ error: 'Invalid role. Must be viewer or streamer' }, 400);
    }

    // Check if username already exists
    const existingUsername = await kv.get(`user:username:${username.toLowerCase()}`);
    if (existingUsername) {
      return c.json({ error: 'Username already exists' }, 409);
    }

    // Create user with Supabase Auth
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { 
        username,
        role,
        created_at: new Date().toISOString()
      },
      // Automatically confirm the user's email since an email server hasn't been configured.
      email_confirm: true
    });

    if (error) {
      console.log('Supabase auth error:', error);
      return c.json({ error: 'Failed to create user account' }, 400);
    }

    // Store user data in KV store
    const userData = {
      id: data.user.id,
      username,
      email,
      role,
      created_at: new Date().toISOString()
    };

    await kv.set(`user:${data.user.id}`, userData);
    await kv.set(`user:username:${username.toLowerCase()}`, data.user.id);
    await kv.set(`user:email:${email.toLowerCase()}`, data.user.id);

    return c.json({
      success: true,
      user: userData
    });
  } catch (error) {
    console.log('Signup error:', error);
    return c.json({ error: 'Internal server error during signup' }, 500);
  }
});

// Get user profile
app.get('/auth/profile', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const userData = await kv.get(`user:${user.id}`);
    
    if (!userData) {
      return c.json({ error: 'User profile not found' }, 404);
    }

    return c.json({ user: userData });
  } catch (error) {
    console.log('Profile fetch error:', error);
    return c.json({ error: 'Failed to fetch user profile' }, 500);
  }
});

// Upload video
app.post('/videos/upload', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const userData = await kv.get(`user:${user.id}`);
    
    if (!userData || userData.role !== 'streamer') {
      return c.json({ error: 'Only streamers can upload videos' }, 403);
    }

    const formData = await c.req.formData();
    const title = formData.get('title');
    const description = formData.get('description');
    const genre = formData.get('genre');
    const ageRating = formData.get('ageRating');
    const videoFile = formData.get('video');
    const thumbnailUrl = formData.get('thumbnailUrl');

    if (!title || !description || !genre || !ageRating || !videoFile) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const videoId = uuidv4();
    const videoFileName = `${videoId}-${videoFile.name}`;

    // Upload video file to storage
    const { data: videoUpload, error: videoError } = await supabase.storage
      .from('streamhub-videos')
      .upload(videoFileName, videoFile);

    if (videoError) {
      console.log('Video upload error:', videoError);
      return c.json({ error: 'Failed to upload video file' }, 500);
    }

    // Get signed URL for video
    const { data: videoSignedUrl } = await supabase.storage
      .from('streamhub-videos')
      .createSignedUrl(videoFileName, 60 * 60 * 24 * 7); // 7 days

    // Create video metadata
    const videoData = {
      id: videoId,
      title,
      description,
      genre,
      ageRating,
      publisher: userData.username,
      producer: userData.username,
      uploadedBy: userData.username,
      uploaderId: user.id,
      videoUrl: videoSignedUrl?.signedUrl || '',
      videoPath: videoFileName,
      thumbnail: thumbnailUrl || 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&h=225&fit=crop',
      uploadDate: new Date().toISOString(),
      rating: 0,
      totalRatings: 0,
      views: 0,
      comments: []
    };

    // Store video metadata
    await kv.set(`video:${videoId}`, videoData);
    
    // Add to user's videos list
    const userVideos = await kv.get(`user:videos:${user.id}`) || [];
    userVideos.push(videoId);
    await kv.set(`user:videos:${user.id}`, userVideos);

    // Add to global videos list
    const allVideos = await kv.get('videos:all') || [];
    allVideos.unshift(videoId);
    await kv.set('videos:all', allVideos);

    return c.json({
      success: true,
      video: videoData
    });
  } catch (error) {
    console.log('Video upload error:', error);
    return c.json({ error: 'Internal server error during video upload' }, 500);
  }
});

// Get all videos
app.get('/videos', async (c) => {
  console.log('GET /videos request received');
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const search = c.req.query('search') || '';
    
    console.log('Query parameters:', { page, limit, search });
    
    // Get all entries with video: prefix
    const entries = await kv.getByPrefix('video:');
    console.log('Found KV entries:', entries);
    
    // Filter out only the video entries (not metadata)
    const videos = entries
      .filter(entry => entry.key.startsWith('video:') && !entry.key.includes(':', 6))
      .map(entry => {
        const video = entry.value;
        // Get the server's base URL
        const serverUrl = 'http://localhost:3001';
        
        // Ensure video URLs are properly formatted
        if (video.videoUrl && !video.videoUrl.startsWith('http')) {
          video.videoUrl = `${serverUrl}${video.videoUrl}`;
        }
        if (video.thumbnail && !video.thumbnail.startsWith('http')) {
          video.thumbnail = `${serverUrl}${video.thumbnail}`;
        }
        return video;
      })
      .filter(Boolean);

    console.log('Processed videos:', videos);

    // Filter by search if provided
    let filteredVideos = videos;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredVideos = videos.filter(video =>
        video.title.toLowerCase().includes(searchLower) ||
        video.description.toLowerCase().includes(searchLower) ||
        video.genre.toLowerCase().includes(searchLower) ||
        video.uploadedBy.toLowerCase().includes(searchLower)
      );
    }

    // Filter by search if provided
    const searchResults = search ? videos.filter(video => {
      const searchLower = search.toLowerCase();
      return video.title.toLowerCase().includes(searchLower) ||
        video.description.toLowerCase().includes(searchLower) ||
        video.genre.toLowerCase().includes(searchLower) ||
        video.uploadedBy.toLowerCase().includes(searchLower);
    }) : videos;

    // Sort by upload date (newest first)
    const sortedVideos = [...searchResults].sort((a, b) => 
      new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
    );

    // Paginate
    const startIndex = (page - 1) * limit;
    const paginatedVideos = sortedVideos.slice(startIndex, startIndex + limit);

    console.log('Returning videos:', {
      total: sortedVideos.length,
      page,
      limit,
      hasMore: startIndex + limit < sortedVideos.length
    });

    return c.json({
      videos: paginatedVideos,
      total: sortedVideos.length,
      page,
      limit,
      hasMore: startIndex + limit < sortedVideos.length
    });
  } catch (error) {
    console.error('Videos fetch error:', error);
    return c.json({ 
      error: 'Failed to fetch videos',
      details: error.message 
    }, 500);
  }
});

// Get single video
app.get('/videos/:id', async (c) => {
  try {
    const videoId = c.req.param('id');
    const video = await kv.get(`video:${videoId}`);
    
    if (!video) {
      return c.json({ error: 'Video not found' }, 404);
    }

    // Update video URL with fresh signed URL
    if (video.videoPath) {
      const { data: signedUrl } = await supabase.storage
        .from('streamhub-videos')
        .createSignedUrl(video.videoPath, 60 * 60 * 24 * 7);
      
      if (signedUrl) {
        video.videoUrl = signedUrl.signedUrl;
      }
    }

    return c.json({ video });
  } catch (error) {
    console.log('Video fetch error:', error);
    return c.json({ error: 'Failed to fetch video' }, 500);
  }
});

// Track video view
app.post('/videos/:id/view', async (c) => {
  try {
    const videoId = c.req.param('id');
    const video = await kv.get(`video:${videoId}`);
    
    if (!video) {
      return c.json({ error: 'Video not found' }, 404);
    }

    video.views = (video.views || 0) + 1;
    await kv.set(`video:${videoId}`, video);

    return c.json({ views: video.views });
  } catch (error) {
    console.log('View tracking error:', error);
    return c.json({ error: 'Failed to track view' }, 500);
  }
});

// Rate video
app.post('/videos/:id/rate', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const userData = await kv.get(`user:${user.id}`);
    
    if (!userData || userData.role !== 'viewer') {
      return c.json({ error: 'Only viewers can rate videos' }, 403);
    }

    const videoId = c.req.param('id');
    const { rating } = await c.req.json();
    
    if (!rating || rating < 1 || rating > 5) {
      return c.json({ error: 'Rating must be between 1 and 5' }, 400);
    }

    const video = await kv.get(`video:${videoId}`);
    if (!video) {
      return c.json({ error: 'Video not found' }, 404);
    }

    // Check if user already rated this video
    const existingRating = await kv.get(`rating:${user.id}:${videoId}`);
    if (existingRating) {
      return c.json({ error: 'You have already rated this video' }, 409);
    }

    // Update video rating
    const newTotalRatings = video.totalRatings + 1;
    const newRating = ((video.rating * video.totalRatings) + rating) / newTotalRatings;
    
    video.rating = newRating;
    video.totalRatings = newTotalRatings;
    
    await kv.set(`video:${videoId}`, video);
    await kv.set(`rating:${user.id}:${videoId}`, { rating, timestamp: new Date().toISOString() });

    return c.json({
      rating: video.rating,
      totalRatings: video.totalRatings
    });
  } catch (error) {
    console.log('Rating error:', error);
    return c.json({ error: 'Failed to rate video' }, 500);
  }
});

// Add comment
app.post('/videos/:id/comments', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const userData = await kv.get(`user:${user.id}`);
    
    if (!userData) {
      return c.json({ error: 'User not found' }, 404);
    }

    const videoId = c.req.param('id');
    const { content } = await c.req.json();
    
    if (!content || !content.trim()) {
      return c.json({ error: 'Comment content is required' }, 400);
    }

    const video = await kv.get(`video:${videoId}`);
    if (!video) {
      return c.json({ error: 'Video not found' }, 404);
    }

    const commentId = uuidv4();
    const comment = {
      id: commentId,
      userId: user.id,
      username: userData.username,
      content: content.trim(),
      timestamp: 'just now',
      createdAt: new Date().toISOString()
    };

    // Add comment to video
    video.comments = video.comments || [];
    video.comments.unshift(comment);
    await kv.set(`video:${videoId}`, video);

    // Store comment separately for easier querying
    await kv.set(`comment:${commentId}`, comment);

    return c.json({
      success: true,
      comment
    });
  } catch (error) {
    console.log('Comment error:', error);
    return c.json({ error: 'Failed to add comment' }, 500);
  }
});

// Local mode: create video without Supabase storage (persists in KV)
app.post('/local/videos', async (c) => {
  try {
    console.log('Received video creation request');
    const { title, description, genre, ageRating, videoUrl, thumbnail, uploadedBy } = await c.req.json();
    console.log('Video data received:', { title, description, genre, ageRating, videoUrl, thumbnail, uploadedBy });

    if (!title || !description || !genre || !ageRating || !videoUrl || !uploadedBy) {
      console.log('Missing required fields');
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const videoId = uuidv4();
    const videoData = {
      id: videoId,
      title,
      description,
      genre,
      ageRating,
      publisher: uploadedBy,
      producer: uploadedBy,
      uploadedBy,
      uploaderId: null,
      videoUrl, // direct URL or relative path to local asset
      // No videoPath -> prevents Supabase signed URL logic
      thumbnail: thumbnail || 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&h=225&fit=crop',
      uploadDate: new Date().toISOString(),
      rating: 0,
      totalRatings: 0,
      views: 0,
      comments: []
    };

    console.log('Saving video data:', videoData);
    await kv.set(`video:${videoId}`, videoData);

    const allVideos = await kv.get('videos:all') || [];
    console.log('Current videos list:', allVideos);
    allVideos.unshift(videoId);
    await kv.set('videos:all', allVideos);
    console.log('Updated videos list:', allVideos);

    return c.json({ success: true, video: videoData });
  } catch (error) {
    console.log('Local video create error:', error);
    return c.json({ error: 'Failed to create local video' }, 500);
  }
});

// Local file upload: saves file to ./videos and returns a public URL
app.post('/local/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file || typeof file.name !== 'string') {
      return c.json({ error: 'No file provided' }, 400);
    }

    // Create videos directory if it doesn't exist
    const videosDir = path.join(process.cwd(), 'videos');
    await fs.mkdir(videosDir, { recursive: true });

    // Sanitize filename and add unique identifier
    const originalName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const extMatch = /\.[a-zA-Z0-9]+$/.exec(originalName);
    const ext = extMatch ? extMatch[0] : '.mp4';
    const filename = `${uuidv4()}-${originalName}`;
    const fullPath = path.join(videosDir, filename);

    // Save the file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(fullPath, buffer);

    // Create a thumbnail directory if it doesn't exist
    const thumbnailsDir = path.join(process.cwd(), 'videos', 'thumbnails');
    await fs.mkdir(thumbnailsDir, { recursive: true });

    // For now, we'll use a default thumbnail path
    // In a production system, you might want to generate actual thumbnails
    const defaultThumbnailPath = '/videos/thumbnails/default.jpg';

    // Return both video and thumbnail URLs
    const url = `/videos/${filename}`;
    return c.json({ 
      url,
      path: `videos/${filename}`,
      thumbnail: defaultThumbnailPath
    });
  } catch (error) {
    console.log('Local upload error:', error);
    return c.json({ error: 'Failed to upload file' }, 500);
  }
});

// Local users: list and create (KV-only, no Supabase)
app.get('/local/users', async (c) => {
  try {
    const entries = await kv.getByPrefix('user:');
    const users = entries
      .filter((item) => item.key.startsWith('user:') && !item.key.includes(':', 5))
      .map((item) => item.value)
      .filter(Boolean);
    return c.json({ users });
  } catch (error) {
    console.log('Local users fetch error:', error);
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

app.post('/local/users', async (c) => {
  try {
    const { username, email, password, role } = await c.req.json();
    if (!username || !email || !password || !role) {
      return c.json({ error: 'Missing required fields' }, 400);
    }
    const existingUsername = await kv.get(`user:username:${username.toLowerCase()}`);
    const existingEmail = await kv.get(`user:email:${email.toLowerCase()}`);
    if (existingUsername || existingEmail) {
      return c.json({ error: 'User already exists' }, 409);
    }
    const id = uuidv4();
    const userData = {
      id,
      username,
      email,
      password,
      role,
      created_at: new Date().toISOString()
    };
    await kv.set(`user:${id}`, userData);
    await kv.set(`user:username:${username.toLowerCase()}`, id);
    await kv.set(`user:email:${email.toLowerCase()}`, id);
    return c.json({ success: true, user: userData });
  } catch (error) {
    console.log('Local user create error:', error);
    return c.json({ error: 'Failed to create user' }, 500);
  }
});

// Danger: Delete all users (KV-only)
app.post('/local/users/delete-all', async (c) => {
  try {
    const entries = await kv.getByPrefix('user:');
    const keys = entries.map((e) => e.key);
    if (keys.length > 0) {
      await kv.mdel(keys);
    }
    return c.json({ success: true, deleted: keys.length });
  } catch (error) {
    console.log('Delete all users error:', error);
    return c.json({ error: 'Failed to delete users' }, 500);
  }
});

// Seed a specific streamer user: username=adedayo, email=ade@dayo.com
app.post('/local/users/seed-adedayo', async (c) => {
  try {
    const username = 'adedayo';
    const email = 'ade@dayo.com';
    const existingUsername = await kv.get(`user:username:${username}`);
    const existingEmail = await kv.get(`user:email:${email}`);
    if (existingUsername || existingEmail) {
      const id = existingUsername || existingEmail;
      const user = await kv.get(`user:${id}`);
      return c.json({ success: true, user, created: false });
    }

    const id = uuidv4();
    const userData = {
      id,
      username,
      email,
      password: 'Password123',
      role: 'streamer',
      created_at: new Date().toISOString()
    };
    await kv.set(`user:${id}`, userData);
    await kv.set(`user:username:${username}`, id);
    await kv.set(`user:email:${email}`, id);
    return c.json({ success: true, user: userData, created: true });
  } catch (error) {
    console.log('Seed adedayo error:', error);
    return c.json({ error: 'Failed to seed user' }, 500);
  }
});

// Get platform statistics
app.get('/stats', async (c) => {
  try {
    const allVideoIds = await kv.get('videos:all') || [];
    const videos = [];
    
    for (const videoId of allVideoIds) {
      const video = await kv.get(`video:${videoId}`);
      if (video) videos.push(video);
    }

    const totalViews = videos.reduce((sum, video) => sum + (video.views || 0), 0);
    const totalRatings = videos.reduce((sum, video) => sum + (video.totalRatings || 0), 0);
    
    // Count users by role (this is a simplified approach)
    const userKeys = await kv.getByPrefix('user:');
    const users = userKeys.filter(item => item.key.startsWith('user:') && !item.key.includes(':'));
    const streamers = users.filter(item => item.value?.role === 'streamer').length;
    const viewers = users.filter(item => item.value?.role === 'viewer').length;

    return c.json({
      totalVideos: videos.length,
      totalViews,
      totalRatings,
      streamers,
      viewers
    });
  } catch (error) {
    console.log('Stats error:', error);
    return c.json({ error: 'Failed to fetch statistics' }, 500);
  }
});

// Handle static files and SPA routing
app.use('*', async (c, next) => {
  // Skip static file handling for API routes
  if (c.req.url.pathname.startsWith('/api') || 
      c.req.url.pathname.startsWith('/auth') || 
      c.req.url.pathname.startsWith('/videos') ||
      c.req.url.pathname.startsWith('/local')) {
    await next();
    return;
  }

  const filePath = '.' + (c.req.url.pathname === '/' ? '/index.html' : c.req.url.pathname);
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4'
    };
    
    c.header('Content-Type', contentTypes[ext] || 'application/octet-stream');
    return c.body(content);
  } catch (error) {
    // If file not found, serve index.html for client-side routing
    if (error.code === 'ENOENT') {
      try {
        const content = await fs.readFile('./index.html', 'utf-8');
        c.header('Content-Type', 'text/html');
        return c.html(content);
      } catch (err) {
        console.error('Error reading index.html:', err);
        return c.text('Server Error', 500);
      }
    }
    console.error('Error serving file:', error);
    return c.text('Server Error', 500);
  }
});

const port = process.env.PORT || 3001;

serve({
  fetch: app.fetch,
  port: port,
});

console.log(`🚀 StreamHub backend server is running on http://localhost:${port}`);