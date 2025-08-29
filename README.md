# StreamHub Local Backend

This is the local Node.js backend server for StreamHub, providing the same functionality as the Supabase Edge Functions but running on your local machine.

## Features

- **User Authentication**: Secure signup/login with Supabase Auth
- **Video Management**: Upload, view, rate, and comment on videos
- **File Storage**: Video uploads to Supabase Storage
- **Real-time Stats**: Platform statistics and analytics
- **Search & Filtering**: Video search functionality
- **Role-based Access**: Streamer and viewer permissions

## Prerequisites

- Node.js 18+ installed
- Supabase project with authentication and storage enabled
- Supabase credentials (URL, anon key, service role key)

## Setup Instructions

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Environment Configuration
1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Supabase credentials:
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_ANON_KEY=your_anon_key_here
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   PORT=3001
   ```

### 3. Get Supabase Credentials

From your Supabase dashboard:
1. **SUPABASE_URL**: Go to Settings → API → Project URL
2. **SUPABASE_ANON_KEY**: Go to Settings → API → Project API keys → anon key
3. **SUPABASE_SERVICE_ROLE_KEY**: Go to Settings → API → Project API keys → service_role key

### 4. Start the Server
```bash
# Development mode (auto-restart on changes)
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:3001`

### 5. Verify Setup
Check if the server is running:
```bash
curl http://localhost:3001/health
```

You should see: `{"status":"ok","timestamp":"..."}`

## API Endpoints

### Authentication
- `POST /auth/signup` - User registration
- `GET /auth/profile` - Get user profile (protected)

### Videos
- `GET /videos` - Get all videos (with search and pagination)
- `GET /videos/:id` - Get single video
- `POST /videos/upload` - Upload video (streamers only)
- `POST /videos/:id/view` - Track video view
- `POST /videos/:id/rate` - Rate video (viewers only)
- `POST /videos/:id/comments` - Add comment (authenticated)

### Platform
- `GET /stats` - Get platform statistics
- `GET /health` - Health check

## Data Storage

The local backend uses a simple file-based KV store for development:
- Data is stored in `./data/kv-store.json`
- Auto-saves every 30 seconds
- For production, replace with a proper database (PostgreSQL, MongoDB, etc.)

## Frontend Integration

When the local backend is running, the frontend will automatically detect it and use `http://localhost:3001` instead of the Supabase Edge Functions. This allows for:
- Faster development iteration
- Local debugging
- Offline development
- Custom backend modifications

## Development Tips

1. **Hot Reload**: Use `npm run dev` for automatic server restart on file changes
2. **Debugging**: Add `console.log()` statements for debugging
3. **Data Reset**: Delete `./data/kv-store.json` to reset all data
4. **CORS**: The server is configured with permissive CORS for development

## Production Deployment

For production deployment:
1. Replace the file-based KV store with a proper database
2. Add proper error handling and logging
3. Implement rate limiting and security measures
4. Use environment-specific configuration
5. Set up proper authentication and authorization

## Troubleshooting

### Server won't start
- Check if port 3001 is available
- Verify Node.js version (18+)
- Check environment variables are set correctly

### Authentication errors
- Verify Supabase credentials in `.env`
- Check Supabase project settings
- Ensure service role key has proper permissions

### File upload errors
- Verify Supabase Storage is enabled
- Check bucket permissions
- Ensure sufficient storage quota

### CORS errors
- Check if frontend is running on expected port
- Verify CORS configuration in server

## Support

If you encounter issues:
1. Check the server logs for error messages
2. Verify your Supabase configuration
3. Test the health endpoint
4. Check network connectivity

The local backend provides the same functionality as the cloud version while giving you full control over the development environment.