// Word lists the generators draw from. Invented brands and companies; real
// cities and airports because a flight from Miami to Buenos Aires should
// look like one.

export const FIRST_NAMES = [
  'Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Mateo', 'Sofia', 'Lucas', 'Isabella', 'Ethan',
  'Mia', 'Santiago', 'Camila', 'Benjamin', 'Valentina', 'Daniel', 'Lucia', 'Sebastian', 'Emilia', 'Gabriel',
  'Chloe', 'Julian', 'Zoe', 'Adrian', 'Elena', 'Marco', 'Nora', 'Diego', 'Alice', 'Tomas',
  'Hannah', 'Felix', 'Clara', 'Leon', 'Ines', 'Rafael', 'Maya', 'Oscar', 'Layla', 'Hugo',
  'Amara', 'Kenji', 'Yuki', 'Ravi', 'Priya', 'Arjun', 'Aisha', 'Omar', 'Fatima', 'Youssef',
  'Ingrid', 'Sven', 'Freya', 'Mikkel', 'Anouk', 'Bram', 'Sinead', 'Declan', 'Giulia', 'Matteo',
  'Rosa', 'Joaquin', 'Paula', 'Nicolas', 'Martina', 'Bruno', 'Renata', 'Andres', 'Carolina', 'Facundo',
  'Grace', 'Henry', 'Ruby', 'Jack', 'Ivy', 'Theo', 'Nina', 'Max', 'Lena', 'Sam',
]

export const LAST_NAMES = [
  'Garcia', 'Smith', 'Rodriguez', 'Johnson', 'Martinez', 'Brown', 'Lopez', 'Williams', 'Gonzalez', 'Jones',
  'Fernandez', 'Miller', 'Perez', 'Davis', 'Sanchez', 'Wilson', 'Romero', 'Anderson', 'Torres', 'Taylor',
  'Silva', 'Moore', 'Rossi', 'Thomas', 'Ferrari', 'Jackson', 'Russo', 'White', 'Bianchi', 'Harris',
  'Muller', 'Clark', 'Schmidt', 'Lewis', 'Schneider', 'Walker', 'Fischer', 'Hall', 'Weber', 'Young',
  'Dubois', 'King', 'Moreau', 'Wright', 'Laurent', 'Scott', 'Lefebvre', 'Green', 'Roux', 'Baker',
  'Tanaka', 'Adams', 'Sato', 'Nelson', 'Suzuki', 'Hill', 'Kim', 'Campbell', 'Park', 'Mitchell',
  'Nguyen', 'Carter', 'Tran', 'Roberts', 'Khan', 'Turner', 'Ahmed', 'Phillips', 'Ali', 'Evans',
  'Okafor', 'Collins', 'Mensah', 'Stewart', 'Abebe', 'Morris', 'Costa', 'Murphy', 'Pereira', 'Cook',
]

export interface City {
  city: string
  region: string
  country: string // ISO 3166-1 alpha-2
  tz: string
  lat: number
  lon: number
  airport: string // IATA
  airportName: string
}

export const CITIES: City[] = [
  { city: 'Miami', region: 'FL', country: 'US', tz: 'America/New_York', lat: 25.7617, lon: -80.1918, airport: 'MIA', airportName: 'Miami International' },
  { city: 'New York', region: 'NY', country: 'US', tz: 'America/New_York', lat: 40.7128, lon: -74.006, airport: 'JFK', airportName: 'John F. Kennedy International' },
  { city: 'Los Angeles', region: 'CA', country: 'US', tz: 'America/Los_Angeles', lat: 34.0522, lon: -118.2437, airport: 'LAX', airportName: 'Los Angeles International' },
  { city: 'Chicago', region: 'IL', country: 'US', tz: 'America/Chicago', lat: 41.8781, lon: -87.6298, airport: 'ORD', airportName: "O'Hare International" },
  { city: 'Houston', region: 'TX', country: 'US', tz: 'America/Chicago', lat: 29.7604, lon: -95.3698, airport: 'IAH', airportName: 'George Bush Intercontinental' },
  { city: 'Seattle', region: 'WA', country: 'US', tz: 'America/Los_Angeles', lat: 47.6062, lon: -122.3321, airport: 'SEA', airportName: 'Seattle–Tacoma International' },
  { city: 'Denver', region: 'CO', country: 'US', tz: 'America/Denver', lat: 39.7392, lon: -104.9903, airport: 'DEN', airportName: 'Denver International' },
  { city: 'Atlanta', region: 'GA', country: 'US', tz: 'America/New_York', lat: 33.749, lon: -84.388, airport: 'ATL', airportName: 'Hartsfield–Jackson Atlanta International' },
  { city: 'Toronto', region: 'ON', country: 'CA', tz: 'America/Toronto', lat: 43.6532, lon: -79.3832, airport: 'YYZ', airportName: 'Toronto Pearson International' },
  { city: 'Vancouver', region: 'BC', country: 'CA', tz: 'America/Vancouver', lat: 49.2827, lon: -123.1207, airport: 'YVR', airportName: 'Vancouver International' },
  { city: 'Mexico City', region: 'CDMX', country: 'MX', tz: 'America/Mexico_City', lat: 19.4326, lon: -99.1332, airport: 'MEX', airportName: 'Benito Juárez International' },
  { city: 'Buenos Aires', region: 'CABA', country: 'AR', tz: 'America/Argentina/Buenos_Aires', lat: -34.6037, lon: -58.3816, airport: 'EZE', airportName: 'Ministro Pistarini International' },
  { city: 'Córdoba', region: 'Córdoba', country: 'AR', tz: 'America/Argentina/Cordoba', lat: -31.4201, lon: -64.1888, airport: 'COR', airportName: 'Ingeniero Ambrosio Taravella' },
  { city: 'São Paulo', region: 'SP', country: 'BR', tz: 'America/Sao_Paulo', lat: -23.5505, lon: -46.6333, airport: 'GRU', airportName: 'São Paulo–Guarulhos International' },
  { city: 'Rio de Janeiro', region: 'RJ', country: 'BR', tz: 'America/Sao_Paulo', lat: -22.9068, lon: -43.1729, airport: 'GIG', airportName: 'Rio de Janeiro–Galeão International' },
  { city: 'Santiago', region: 'RM', country: 'CL', tz: 'America/Santiago', lat: -33.4489, lon: -70.6693, airport: 'SCL', airportName: 'Arturo Merino Benítez International' },
  { city: 'Bogotá', region: 'DC', country: 'CO', tz: 'America/Bogota', lat: 4.711, lon: -74.0721, airport: 'BOG', airportName: 'El Dorado International' },
  { city: 'Lima', region: 'Lima', country: 'PE', tz: 'America/Lima', lat: -12.0464, lon: -77.0428, airport: 'LIM', airportName: 'Jorge Chávez International' },
  { city: 'London', region: 'England', country: 'GB', tz: 'Europe/London', lat: 51.5074, lon: -0.1278, airport: 'LHR', airportName: 'Heathrow' },
  { city: 'Manchester', region: 'England', country: 'GB', tz: 'Europe/London', lat: 53.4808, lon: -2.2426, airport: 'MAN', airportName: 'Manchester' },
  { city: 'Dublin', region: 'Leinster', country: 'IE', tz: 'Europe/Dublin', lat: 53.3498, lon: -6.2603, airport: 'DUB', airportName: 'Dublin' },
  { city: 'Paris', region: 'Île-de-France', country: 'FR', tz: 'Europe/Paris', lat: 48.8566, lon: 2.3522, airport: 'CDG', airportName: 'Charles de Gaulle' },
  { city: 'Madrid', region: 'Madrid', country: 'ES', tz: 'Europe/Madrid', lat: 40.4168, lon: -3.7038, airport: 'MAD', airportName: 'Adolfo Suárez Madrid–Barajas' },
  { city: 'Barcelona', region: 'Catalonia', country: 'ES', tz: 'Europe/Madrid', lat: 41.3874, lon: 2.1686, airport: 'BCN', airportName: 'Josep Tarradellas Barcelona–El Prat' },
  { city: 'Lisbon', region: 'Lisboa', country: 'PT', tz: 'Europe/Lisbon', lat: 38.7223, lon: -9.1393, airport: 'LIS', airportName: 'Humberto Delgado' },
  { city: 'Berlin', region: 'Berlin', country: 'DE', tz: 'Europe/Berlin', lat: 52.52, lon: 13.405, airport: 'BER', airportName: 'Berlin Brandenburg' },
  { city: 'Munich', region: 'Bavaria', country: 'DE', tz: 'Europe/Berlin', lat: 48.1351, lon: 11.582, airport: 'MUC', airportName: 'Munich' },
  { city: 'Frankfurt', region: 'Hesse', country: 'DE', tz: 'Europe/Berlin', lat: 50.1109, lon: 8.6821, airport: 'FRA', airportName: 'Frankfurt' },
  { city: 'Amsterdam', region: 'North Holland', country: 'NL', tz: 'Europe/Amsterdam', lat: 52.3676, lon: 4.9041, airport: 'AMS', airportName: 'Schiphol' },
  { city: 'Zurich', region: 'Zurich', country: 'CH', tz: 'Europe/Zurich', lat: 47.3769, lon: 8.5417, airport: 'ZRH', airportName: 'Zurich' },
  { city: 'Milan', region: 'Lombardy', country: 'IT', tz: 'Europe/Rome', lat: 45.4642, lon: 9.19, airport: 'MXP', airportName: 'Milan Malpensa' },
  { city: 'Rome', region: 'Lazio', country: 'IT', tz: 'Europe/Rome', lat: 41.9028, lon: 12.4964, airport: 'FCO', airportName: 'Leonardo da Vinci–Fiumicino' },
  { city: 'Vienna', region: 'Vienna', country: 'AT', tz: 'Europe/Vienna', lat: 48.2082, lon: 16.3738, airport: 'VIE', airportName: 'Vienna International' },
  { city: 'Copenhagen', region: 'Capital Region', country: 'DK', tz: 'Europe/Copenhagen', lat: 55.6761, lon: 12.5683, airport: 'CPH', airportName: 'Copenhagen' },
  { city: 'Stockholm', region: 'Stockholm', country: 'SE', tz: 'Europe/Stockholm', lat: 59.3293, lon: 18.0686, airport: 'ARN', airportName: 'Stockholm Arlanda' },
  { city: 'Warsaw', region: 'Masovia', country: 'PL', tz: 'Europe/Warsaw', lat: 52.2297, lon: 21.0122, airport: 'WAW', airportName: 'Warsaw Chopin' },
  { city: 'Istanbul', region: 'Istanbul', country: 'TR', tz: 'Europe/Istanbul', lat: 41.0082, lon: 28.9784, airport: 'IST', airportName: 'Istanbul' },
  { city: 'Dubai', region: 'Dubai', country: 'AE', tz: 'Asia/Dubai', lat: 25.2048, lon: 55.2708, airport: 'DXB', airportName: 'Dubai International' },
  { city: 'Mumbai', region: 'Maharashtra', country: 'IN', tz: 'Asia/Kolkata', lat: 19.076, lon: 72.8777, airport: 'BOM', airportName: 'Chhatrapati Shivaji Maharaj International' },
  { city: 'Bengaluru', region: 'Karnataka', country: 'IN', tz: 'Asia/Kolkata', lat: 12.9716, lon: 77.5946, airport: 'BLR', airportName: 'Kempegowda International' },
  { city: 'Singapore', region: 'Singapore', country: 'SG', tz: 'Asia/Singapore', lat: 1.3521, lon: 103.8198, airport: 'SIN', airportName: 'Singapore Changi' },
  { city: 'Tokyo', region: 'Tokyo', country: 'JP', tz: 'Asia/Tokyo', lat: 35.6762, lon: 139.6503, airport: 'HND', airportName: 'Tokyo Haneda' },
  { city: 'Seoul', region: 'Seoul', country: 'KR', tz: 'Asia/Seoul', lat: 37.5665, lon: 126.978, airport: 'ICN', airportName: 'Incheon International' },
  { city: 'Sydney', region: 'NSW', country: 'AU', tz: 'Australia/Sydney', lat: -33.8688, lon: 151.2093, airport: 'SYD', airportName: 'Sydney Kingsford Smith' },
  { city: 'Melbourne', region: 'VIC', country: 'AU', tz: 'Australia/Melbourne', lat: -37.8136, lon: 144.9631, airport: 'MEL', airportName: 'Melbourne' },
  { city: 'Auckland', region: 'Auckland', country: 'NZ', tz: 'Pacific/Auckland', lat: -36.8509, lon: 174.7645, airport: 'AKL', airportName: 'Auckland' },
  { city: 'Johannesburg', region: 'Gauteng', country: 'ZA', tz: 'Africa/Johannesburg', lat: -26.2041, lon: 28.0473, airport: 'JNB', airportName: 'O. R. Tambo International' },
  { city: 'Cape Town', region: 'Western Cape', country: 'ZA', tz: 'Africa/Johannesburg', lat: -33.9249, lon: 18.4241, airport: 'CPT', airportName: 'Cape Town International' },
  { city: 'Lagos', region: 'Lagos', country: 'NG', tz: 'Africa/Lagos', lat: 6.5244, lon: 3.3792, airport: 'LOS', airportName: 'Murtala Muhammed International' },
  { city: 'Nairobi', region: 'Nairobi', country: 'KE', tz: 'Africa/Nairobi', lat: -1.2921, lon: 36.8219, airport: 'NBO', airportName: 'Jomo Kenyatta International' },
]

export const STREETS = [
  'Main', 'Oak', 'Maple', 'Cedar', 'Pine', 'Elm', 'Washington', 'Lake', 'Hill', 'Park',
  'River', 'Sunset', 'Harbor', 'Market', 'Church', 'Bridge', 'Mill', 'Spring', 'Meadow', 'Forest',
  'Highland', 'Ocean', 'Bay', 'Union', 'Liberty', 'Franklin', 'Jefferson', 'Lincoln', 'Madison', 'Monroe',
  'Willow', 'Birch', 'Aspen', 'Chestnut', 'Walnut', 'Poplar', 'Magnolia', 'Laurel', 'Juniper', 'Cypress',
]
export const STREET_SUFFIXES = ['St', 'Ave', 'Rd', 'Blvd', 'Ln', 'Dr', 'Way', 'Ct', 'Pl', 'Ter']

export const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.example', 'inbox.example', 'post.example']

export const COMPANY_A = ['Blue', 'North', 'Silver', 'Bright', 'Iron', 'Green', 'Golden', 'Swift', 'Clear', 'Prime', 'Summit', 'Harbor', 'Atlas', 'Nova', 'Vertex', 'Cobalt', 'Amber', 'Ridge', 'Delta', 'Pioneer']
export const COMPANY_B = ['Systems', 'Logistics', 'Foods', 'Labs', 'Works', 'Media', 'Partners', 'Holdings', 'Dynamics', 'Trading', 'Studio', 'Supply', 'Analytics', 'Robotics', 'Textiles', 'Energy', 'Marine', 'Farms', 'Motors', 'Software']
export const COMPANY_SUFFIX = ['Inc.', 'LLC', 'Ltd.', 'GmbH', 'S.A.', 'Co.', 'Group', 'AG', 'S.R.L.', 'Pty Ltd']

export interface ProductCategory {
  name: string
  slug: string
  brands: string[]
  adjectives: string[]
  nouns: string[]
  priceLo: number
  priceHi: number
  tags: string[]
}

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  { name: 'Audio', slug: 'audio', brands: ['Sonora', 'Kettleworth', 'Ember', 'Vantablack'], adjectives: ['Wireless', 'Studio', 'Compact', 'Noise-cancelling', 'Portable', 'Reference'], nouns: ['Headphones', 'Earbuds', 'Speaker', 'Soundbar', 'Turntable', 'Microphone'], priceLo: 19, priceHi: 899, tags: ['bluetooth', 'hi-fi', 'travel', 'studio'] },
  { name: 'Computers', slug: 'computers', brands: ['Northlight', 'Quill', 'Halden', 'Brisk'], adjectives: ['Ultrabook', 'Workstation', 'Gaming', 'Mini', 'Convertible', 'Rugged'], nouns: ['Laptop', 'Desktop', 'Monitor', 'Keyboard', 'Mouse', 'Docking Station'], priceLo: 29, priceHi: 3499, tags: ['work', 'gaming', 'usb-c', 'ergonomic'] },
  { name: 'Home', slug: 'home', brands: ['Hearth & Co.', 'Linden', 'Marrow', 'Tessel'], adjectives: ['Ceramic', 'Cast-iron', 'Linen', 'Oak', 'Stainless', 'Scented'], nouns: ['Kettle', 'Skillet', 'Throw Blanket', 'Lamp', 'Vase', 'Candle'], priceLo: 9, priceHi: 349, tags: ['kitchen', 'decor', 'gift', 'handmade'] },
  { name: 'Outdoors', slug: 'outdoors', brands: ['Trailhead', 'Kestrel', 'Basalt', 'Fjord'], adjectives: ['Lightweight', 'Waterproof', 'Insulated', 'Ultralight', 'Trail', 'Alpine'], nouns: ['Tent', 'Backpack', 'Jacket', 'Sleeping Bag', 'Headlamp', 'Water Bottle'], priceLo: 12, priceHi: 799, tags: ['camping', 'hiking', 'winter', 'travel'] },
  { name: 'Fitness', slug: 'fitness', brands: ['Pulse', 'Granite', 'Motive', 'Tandem'], adjectives: ['Adjustable', 'Foldable', 'Smart', 'Heavy-duty', 'Resistance', 'Recovery'], nouns: ['Dumbbells', 'Yoga Mat', 'Kettlebell', 'Rowing Machine', 'Jump Rope', 'Foam Roller'], priceLo: 8, priceHi: 1299, tags: ['home-gym', 'cardio', 'strength', 'yoga'] },
  { name: 'Books', slug: 'books', brands: ['Larkspur Press', 'Meridian House', 'Tidewater', 'Foxglove'], adjectives: ['Illustrated', 'Pocket', 'Collected', 'Annotated', 'Beginner’s', 'Complete'], nouns: ['Field Guide', 'Cookbook', 'Atlas', 'Novel', 'Handbook', 'Anthology'], priceLo: 6, priceHi: 89, tags: ['paperback', 'hardcover', 'reference', 'gift'] },
  { name: 'Toys', slug: 'toys', brands: ['Wobble', 'Pipsqueak', 'Kinder Forge', 'Tumble'], adjectives: ['Wooden', 'Magnetic', 'Plush', 'Building', 'Remote-control', 'Puzzle'], nouns: ['Blocks', 'Train Set', 'Robot', 'Dinosaur', 'Board Game', 'Kite'], priceLo: 5, priceHi: 199, tags: ['ages-3+', 'ages-8+', 'educational', 'outdoor'] },
  { name: 'Garden', slug: 'garden', brands: ['Verdant', 'Rootstock', 'Sunhouse', 'Pebble'], adjectives: ['Raised', 'Self-watering', 'Galvanized', 'Solar', 'Cordless', 'Heirloom'], nouns: ['Planter', 'Trowel Set', 'Hose Reel', 'Bird Feeder', 'Seed Kit', 'Pruner'], priceLo: 7, priceHi: 449, tags: ['patio', 'vegetables', 'tools', 'spring'] },
]

export const COLORS = ['Black', 'White', 'Graphite', 'Navy', 'Forest', 'Sand', 'Rust', 'Slate', 'Ivory', 'Olive']

export const REVIEW_TITLES = [
  'Exactly what I needed', 'Better than expected', 'Solid, no complaints', 'Not for me', 'Great value',
  'Would buy again', 'Disappointed', 'Does the job', 'Five stars', 'Mixed feelings', 'Built to last', 'Arrived damaged',
]
export const REVIEW_LINES = [
  'Setup took five minutes and it has worked every day since.',
  'The build quality is noticeably better than the last one I owned.',
  'Shipping was quick and the packaging was careful.',
  'It is a little smaller than the photos suggest, so check the dimensions.',
  'Battery life matches the listing, which is rare.',
  'The instructions were unclear but the product itself is fine.',
  'I have been using it for two months and it still looks new.',
  'Customer support answered within a day when I had a question.',
  'The color is slightly different from the picture, more muted.',
  'Works well with the rest of my setup.',
  'It stopped working after three weeks and had to be replaced.',
  'My kids love it and it has survived them so far.',
  'Heavier than I expected, which is actually a good sign here.',
  'Worth the price, though not by a wide margin.',
  'Would recommend to a friend without hesitation.',
]

export const POST_OPENERS = [
  'Finally finished the', 'Quick thought on', 'Unpopular opinion:', 'Today I learned that', 'Weekend project:',
  'Hot take on', 'Three things about', 'Can we talk about', 'Reminder that', 'Notes from',
]
export const POST_TOPICS = [
  'the new espresso setup', 'commuting by bike', 'sourdough starters', 'learning the harmonica', 'our garden this year',
  'cold plunges', 'the marathon plan', 'moving to a new city', 'fixing an old radio', 'the book club pick',
  'working from a cabin', 'homemade pasta', 'birdwatching at dawn', 'the trail near the lake', 'building a bookshelf',
  'winter camping', 'the chess opening I keep losing to', 'my first pottery class', 'restoring a bicycle', 'street photography',
]
export const POST_CLOSERS = [
  'More soon.', 'Thoughts?', 'Would do it again.', 'Not what I expected.', 'Worth every minute.',
  'Ask me anything.', 'Photos in the replies.', 'Lessons learned, mostly the hard way.', 'Ten out of ten.', 'Never again.',
]
export const COMMENT_LINES = [
  'This is great, thanks for sharing.', 'Same here, happened to me last week.', 'Where did you get it?', 'Following for updates.',
  'I disagree, but I see your point.', 'Photos please!', 'Bookmarking this.', 'How long did it take?', 'You convinced me.',
  'Been there. It gets better.', 'Try the other approach, it worked for me.', 'Congrats!', 'This made my day.', 'Tell me more.',
]
export const HASHTAGS = ['weekend', 'diy', 'coffee', 'running', 'travel', 'books', 'garden', 'music', 'food', 'cycling', 'photography', 'hiking', 'cooking', 'chess', 'winter']

export const TICKET_SUBJECTS: Record<string, string[]> = {
  billing: ['Charged twice this month', 'Invoice shows the wrong company name', 'Refund not received', 'How do I change my payment method?', 'Proration on the upgrade looks off', 'Need a receipt for expense reporting'],
  account: ['Cannot log in after password reset', 'Two-factor codes are rejected', 'Merge two accounts', 'Change the email on my account', 'Locked out after too many attempts', 'Delete my account'],
  bug: ['Export button does nothing', 'Dashboard shows yesterday’s numbers', 'Crash when opening a large report', 'Search returns no results for exact matches', 'Timezone off by one hour in the calendar', 'Notifications arrive twice'],
  feature: ['Dark mode for the mobile app', 'Bulk edit for tags', 'Webhooks on invoice paid', 'CSV import with custom columns', 'Keyboard shortcut for new item', 'Shared saved filters'],
  howto: ['How do I set up SSO?', 'Where are the API docs?', 'Can I schedule reports?', 'How to invite a read-only user', 'Exporting all my data', 'Setting up a custom domain'],
}
export const TICKET_LINES = [
  'This started happening after the last update.',
  'I have already tried clearing the cache and signing in again.',
  'It happens on both my laptop and my phone.',
  'Here are the steps to reproduce it.',
  'Our whole team is affected, so this is fairly urgent.',
  'Not urgent, just wanted to flag it.',
  'Happy to jump on a call if that helps.',
  'Let me know if you need screenshots.',
  'Is there a workaround in the meantime?',
  'Thanks in advance for looking into this.',
]
export const AGENT_LINES = [
  'Thanks for reaching out — looking into this now.',
  'I was able to reproduce it and have passed it to the engineering team.',
  'Could you send me the exact time this last happened?',
  'This should be fixed in the release going out tomorrow.',
  'I have applied a credit to your account for the inconvenience.',
  'Closing this for now; reply to reopen if it comes back.',
  'Here is a workaround while we fix the root cause.',
  'I have escalated this to a specialist.',
]

export const MERCHANTS: Record<string, string[]> = {
  groceries: ['Fresh Market', 'Corner Grocer', 'Greenleaf Foods', 'Daily Basket', 'Harvest Co-op'],
  dining: ['Blue Plate Diner', 'La Parrilla', 'Noodle House', 'Café Lumen', 'The Oak Room', 'Taquería Sol'],
  transport: ['City Transit', 'RideNow', 'Metro Parking', 'Northline Rail', 'Airport Shuttle'],
  fuel: ['Petro Stop', 'Highway Fuel', 'QuickGas'],
  shopping: ['Northlight Store', 'Hearth & Co.', 'Trailhead Outfitters', 'Larkspur Books', 'Verdant Garden'],
  utilities: ['City Power & Light', 'Aquaflow Water', 'FiberNet Internet', 'Mobile One'],
  entertainment: ['StreamBox', 'Cinema 12', 'Arcade Alley', 'Concert Hall', 'Museum of Modern Design'],
  health: ['Wellness Pharmacy', 'Downtown Dental', 'Family Clinic', 'Optic Studio'],
  travel: ['Skyway Airlines', 'Harbor Hotel', 'Roam Car Rental', 'Coastal Inn'],
  subscriptions: ['CloudDrive Plus', 'NewsDaily', 'FitTrack Pro', 'Music Unlimited'],
}

export const AIRLINES = [
  { code: 'SH', name: 'Sondahub Air' },
  { code: 'SK', name: 'Skyway Airlines' },
  { code: 'AT', name: 'Atlas Wings' },
  { code: 'NV', name: 'Nova Air' },
  { code: 'CB', name: 'Cobalt Airways' },
  { code: 'MR', name: 'Meridian' },
]
export const AIRCRAFT = ['A320', 'A321neo', 'A330-900', 'A350-900', '737-800', '737 MAX 8', '787-9', '777-300ER', 'E195-E2']

export const DEVICE_TYPES = [
  { type: 'thermostat', model: 'TH-200', metrics: ['temperature', 'humidity', 'setpoint'] },
  { type: 'power_meter', model: 'PM-1', metrics: ['voltage', 'current', 'power_kw', 'energy_kwh'] },
  { type: 'air_quality', model: 'AQ-3', metrics: ['pm25', 'co2_ppm', 'voc', 'temperature'] },
  { type: 'water_meter', model: 'WM-5', metrics: ['flow_lpm', 'pressure_bar', 'total_liters'] },
  { type: 'gateway', model: 'GW-10', metrics: ['cpu_pct', 'mem_pct', 'uptime_s', 'rssi_dbm'] },
  { type: 'door_sensor', model: 'DS-1', metrics: ['open', 'battery_pct', 'rssi_dbm'] },
  { type: 'vibration', model: 'VB-2', metrics: ['rms_mm_s', 'peak_g', 'temperature'] },
  { type: 'gps_tracker', model: 'GT-4', metrics: ['lat', 'lon', 'speed_kmh', 'battery_pct'] },
]
export const SITE_KINDS = ['warehouse', 'office', 'plant', 'store', 'datacenter', 'farm', 'clinic', 'depot']
export const FIRMWARE = ['2.4.1', '2.4.3', '2.5.0', '2.5.2', '3.0.0-rc1', '3.0.0']

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'ARS', 'BRL', 'MXN', 'JPY', 'CAD', 'AUD', 'CHF']

export const TAG_WORDS = ['urgent', 'vip', 'follow-up', 'enterprise', 'trial', 'mobile', 'web', 'api', 'billing', 'legacy']

export const LOREM = [
  'Clear skies over the harbor this morning', 'The long way round is usually the better one', 'A small change, well measured',
  'Coffee first, decisions later', 'Everything looks different at dawn', 'Slow is smooth and smooth is fast',
  'Measure twice, ship once', 'The map is not the territory', 'Quiet streets after the rain', 'Enough light to read by',
]
