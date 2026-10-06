/** Esquemas de validación de cada módulo (nombres en camelCase = columnas en PascalCase). */

const register = {
  name: { type: 'string', required: true, min: 2, max: 100 },
  email: { type: 'string', required: true, email: true, max: 255, lowercase: true },
  password: { type: 'string', required: true, min: 8, max: 100 },
};

const login = {
  email: { type: 'string', required: true, email: true, lowercase: true },
  password: { type: 'string', required: true },
};

const event = {
  title: { type: 'string', required: true, max: 150 },
  description: { type: 'string', nullable: true, max: 1000 },
  location: { type: 'string', nullable: true, max: 200 },
  startAt: { type: 'date', required: true },
  endAt: { type: 'date', nullable: true },
  allDay: { type: 'boolean' },
  color: { type: 'string', nullable: true, max: 20 },
};

const note = {
  title: { type: 'string', required: true, max: 150 },
  content: { type: 'string', nullable: true, max: 100000 },
  color: { type: 'string', nullable: true, max: 20 },
  isPinned: { type: 'boolean' },
};

const todo = {
  title: { type: 'string', required: true, max: 200 },
  description: { type: 'string', nullable: true, max: 1000 },
  dueDate: { type: 'date', nullable: true },
  priority: { type: 'string', values: ['low', 'medium', 'high'] },
  isCompleted: { type: 'boolean' },
};

const expense = {
  description: { type: 'string', required: true, max: 200 },
  amount: { type: 'number', required: true, min: 0, max: 9999999999 },
  category: { type: 'string', max: 50 },
  spentAt: { type: 'date' },
};

const shoppingItem = {
  name: { type: 'string', required: true, max: 150 },
  quantity: { type: 'string', nullable: true, max: 50 },
  isChecked: { type: 'boolean' },
};

const recipeRequest = {
  prompt: { type: 'string', required: true, min: 3, max: 500 },
  servings: { type: 'number', min: 1, max: 50 },
  save: { type: 'boolean' },
};

const place = {
  name: { type: 'string', required: true, max: 100 },
  category: { type: 'string', values: ['home', 'work', 'church', 'school', 'gym', 'family', 'store', 'other'] },
  address: { type: 'string', nullable: true, max: 300 },
  latitude: { type: 'number', required: true, min: -90, max: 90 },
  longitude: { type: 'number', required: true, min: -180, max: 180 },
  notes: { type: 'string', nullable: true, max: 500 },
};

const healthProfile = {
  sex: { type: 'string', required: true, values: ['male', 'female'] },
  birthYear: { type: 'number', required: true, min: 1900, max: 2020 },
  heightCm: { type: 'number', required: true, min: 100, max: 250 },
  weightKg: { type: 'number', required: true, min: 25, max: 350 },
  activityLevel: { type: 'string', values: ['sedentary', 'light', 'moderate', 'active', 'very_active'] },
  goal: { type: 'string', values: ['lose', 'maintain', 'gain'] },
  fitnessLevel: { type: 'string', values: ['beginner', 'intermediate', 'advanced'] },
  daysPerWeek: { type: 'number', min: 1, max: 7 },
  minutesPerSession: { type: 'number', min: 10, max: 180 },
  equipment: { type: 'string', values: ['none', 'dumbbells', 'gym'] },
  limitations: { type: 'string', nullable: true, max: 300 },
};

const workoutGenerate = {
  focus: { type: 'string', nullable: true, max: 100 },
  minutes: { type: 'number', min: 10, max: 180 },
  notes: { type: 'string', nullable: true, max: 300 },
};

const workoutSession = {
  title: { type: 'string', required: true, max: 150 },
  focus: { type: 'string', nullable: true, max: 150 },
  performedAt: { type: 'date' },
  durationMinutes: { type: 'number', required: true, min: 1, max: 600 },
  caloriesBurned: { type: 'number', nullable: true, min: 0, max: 5000 },
  exercises: { type: 'array', max: 30 },
};

const foodLog = {
  eatenAt: { type: 'date' },
  meal: { type: 'string', values: ['breakfast', 'lunch', 'dinner', 'snack'] },
  description: { type: 'string', required: true, max: 300 },
  servings: { type: 'number', min: 0.1, max: 20 },
  calories: { type: 'number', required: true, min: 0, max: 10000 },
  proteinG: { type: 'number', nullable: true, min: 0, max: 1000 },
  carbsG: { type: 'number', nullable: true, min: 0, max: 1000 },
  fatG: { type: 'number', nullable: true, min: 0, max: 1000 },
  imageUrl: { type: 'string', nullable: true, max: 500 },
  recipeId: { type: 'number', nullable: true, min: 1 },
  source: { type: 'string', values: ['text', 'photo', 'recipe', 'manual'] },
};

const nutritionText = {
  text: { type: 'string', required: true, min: 2, max: 600 },
};

const nutritionPhoto = {
  image: { type: 'string', required: true, min: 100, max: 9000000 },
  note: { type: 'string', nullable: true, max: 300 },
};

const profileUpdate = {
  name: { type: 'string', min: 2, max: 100 },
  phone: { type: 'string', nullable: true, max: 30 },
  birthDate: { type: 'date', nullable: true },
  city: { type: 'string', nullable: true, max: 100 },
  bio: { type: 'string', nullable: true, max: 300 },
};

const passwordChange = {
  currentPassword: { type: 'string', required: true },
  newPassword: { type: 'string', required: true, min: 8, max: 100 },
};

const emailChange = {
  email: { type: 'string', required: true, email: true, max: 255, lowercase: true },
  password: { type: 'string', required: true },
};

const passwordConfirm = {
  password: { type: 'string', required: true },
};

const avatarUpload = {
  image: { type: 'string', required: true, min: 100, max: 9000000 },
};

const deviceRegister = {
  token: { type: 'string', required: true, min: 20, max: 400 },
  platform: { type: 'string', values: ['android', 'ios', 'web'] },
};


/* ---------- Presupuesto y apartados ---------- */
const budgetSettings = {
  period: { type: 'string', required: true, values: ['monthly', 'biweekly', 'weekly'] },
  startDay: { type: 'number', min: 1, max: 28 },
  alertsEnabled: { type: 'boolean' },
  rolloverFundId: { type: 'number', nullable: true, min: 1 },
};

const budgetCategory = {
  name: { type: 'string', required: true, min: 1, max: 50 },
  icon: { type: 'string', max: 40 },
  color: { type: 'string', values: ['violet', 'blue', 'coral', 'amber', 'teal', 'ink', 'green', 'pink'] },
};

const budgetPeriodUpdate = {
  income: { type: 'number', nullable: true, min: 0, max: 9999999999 },
  limits: { type: 'array', max: 100 },
};

const budgetClose = {
  fundId: { type: 'number', nullable: true, min: 1 },
};

const savingsFund = {
  name: { type: 'string', required: true, min: 1, max: 60 },
  icon: { type: 'string', max: 40 },
  color: { type: 'string', values: ['violet', 'blue', 'coral', 'amber', 'teal', 'ink', 'green', 'pink'] },
  goal: { type: 'number', nullable: true, min: 0.01, max: 9999999999 },
  goalDate: { type: 'date', nullable: true },
  autoType: { type: 'string', values: ['none', 'fixed', 'percent'] },
  autoValue: { type: 'number', nullable: true, min: 0, max: 9999999999 },
  isArchived: { type: 'boolean' },
  initialBalance: { type: 'number', min: 0, max: 9999999999 },
};

const fundMovement = {
  type: { type: 'string', required: true, values: ['deposit', 'withdraw'] },
  amount: { type: 'number', required: true, min: 0.01, max: 9999999999 },
  note: { type: 'string', nullable: true, max: 200 },
  movedAt: { type: 'date' },
};

module.exports = {
  budgetSettings,
  budgetCategory,
  budgetPeriodUpdate,
  budgetClose,
  savingsFund,
  fundMovement,
  profileUpdate,
  passwordChange,
  emailChange,
  passwordConfirm,
  avatarUpload,
  deviceRegister,
  register,
  login,
  event,
  note,
  todo,
  expense,
  shoppingItem,
  recipeRequest,
  place,
  healthProfile,
  workoutGenerate,
  workoutSession,
  foodLog,
  nutritionText,
  nutritionPhoto,
};
