# Family Command Center

A modern, mobile-first Angular web application designed to help families stay organized with a centralized command center for managing household activities, schedules, and information.

## Features

- **Dashboard**: Overview of all family activities and quick access to features
- **Grocery List**: Manage and track grocery shopping items with completion status
- **Family Calendar**: View upcoming family events and activities with Google Calendar integration
- **Quick Links**: Easy access to important school sites, resources, and frequently visited pages
- **Food Hub**: Complete meal management system
  - **Recipes**: Store and organize family recipes with search, favorites, and **AI-powered recipe suggestions**
  - **Restaurants**: Track favorite restaurants and delivery options
  - **Grocery List**: Smart shopping list management
- **AI Assistant**: Powered by Google Gemini for intelligent suggestions
  - Recipe ideas based on ingredients or preferences
  - Smart grocery list generation from meal plans
  - Weekly meal planning assistance
  - Cooking tips and ingredient substitutions

## Technology Stack

- **Framework**: Angular 17+
- **UI Framework**: Angular Material (Google Material Design)
- **AI Integration**: Google Gemini API for intelligent suggestions
- **Calendar Integration**: Google Calendar API with OAuth 2.0
- **Backend Options**: Firebase/Firestore (optional) or localStorage
- **Styling**: Sass/SCSS
- **Architecture**: Standalone components with lazy loading
- **Design Approach**: Mobile-first responsive design

## Getting Started

### Prerequisites

- **Node.js v20.19 or higher** (or v22.12+) - **IMPORTANT**: The current system has v20.12.2 which needs to be updated
- npm (comes with Node.js)

### Updating Node.js

If you have Node.js v20.12.2, you need to update it first:

**Using nvm (Node Version Manager):**
```bash
nvm install 20.19.0
nvm use 20.19.0
```

**Or download from:** https://nodejs.org/

### Installation

1. **First, ensure Node.js is v20.19 or higher:**
   ```bash
   node --version
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```
   This will install all Angular and Material Design dependencies.

### Development

Run the development server:
```bash
npm start
```

Navigate to `http://localhost:4200/`. The application will automatically reload if you change any source files.

### Troubleshooting

**"Angular CLI requires minimum Node.js version" error:**
- Update Node.js to v20.19+ or v22.12+ (see "Updating Node.js" section above)

**Dependencies not installing:**
- Make sure you're in the project directory
- Try clearing npm cache: `npm cache clean --force`
- Delete `node_modules` and `package-lock.json` if they exist, then run `npm install` again

### Build

Build the project for production:
```bash
npm run build
```

The build artifacts will be stored in the `dist/` directory.

## Configuration

### AI features
AI-powered recipe suggestions, grocery aisle hints, Remi's World quiz questions, the family
chat assistant, and Remi's daily briefing (outfit/breakfast/lunch/dinner ideas) are all served
by Claude, called from Firebase Cloud Functions — never directly from the client. To enable
them, set the `CLAUDE_API_KEY` secret on your Firebase project and deploy `functions/`:
```bash
firebase functions:secrets:set CLAUDE_API_KEY
firebase deploy --only functions
```

### Google Calendar Integration (Optional)
For family calendar features:
- See [GOOGLE_CALENDAR_SETUP.md](GOOGLE_CALENDAR_SETUP.md) for setup instructions

### Firebase/Firestore (Optional)
For cloud storage and family sharing:
- See [FIREBASE_SETUP.md](FIREBASE_SETUP.md) for setup instructions

## Project Structure

```
family-command-center/
├── src/
│   ├── app/
│   │   ├── features/
│   │   │   ├── dashboard/         # Home dashboard component
│   │   │   ├── grocery-list/      # Grocery list management
│   │   │   ├── calendar/          # Family calendar view
│   │   │   └── quick-links/       # Quick access links
│   │   ├── app.component.*        # Main app component with navigation
│   │   ├── app.config.ts          # Application configuration
│   │   └── app.routes.ts          # Route definitions
│   ├── assets/                    # Static assets
│   ├── styles.scss                # Global styles
│   └── index.html                 # Main HTML file
├── angular.json                   # Angular CLI configuration
├── package.json                   # npm dependencies
└── tsconfig.json                  # TypeScript configuration
```

## Design Philosophy

### Mobile-First Approach
- All components are designed for mobile devices first, then enhanced for larger screens
- Responsive layouts that adapt to different screen sizes
- Touch-friendly UI elements with appropriate sizing for mobile interaction
- Progressive enhancement for desktop features

### Material Design
- Follows Google's Material Design principles
- Consistent UI patterns and interactions
- Accessible components with proper ARIA labels
- Smooth animations and transitions

## Future Enhancements

- [ ] Google Calendar API integration for real-time event sync
- [ ] User authentication and multi-family support
- [ ] Push notifications for important events
- [ ] Shopping list sharing and real-time synchronization
- [ ] Customizable quick links with add/edit/delete functionality
- [ ] Recipe manager with meal planning
- [ ] Chore tracker and assignment system
- [ ] Photo gallery for family memories
- [ ] Progressive Web App (PWA) capabilities for offline use

## Contributing

This is a family project, but suggestions and improvements are welcome!

## License

Private family project - All rights reserved
