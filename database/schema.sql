/* =========================================================
   multiApp - Esquema de base de datos (SQL Server)
   Ejecutar en SSMS o Azure Data Studio:
     sqlcmd -S localhost -U sa -P "<password>" -i database/schema.sql
   Todas las fechas se guardan en UTC (DATETIME2).
   ========================================================= */

IF DB_ID('multiApp') IS NULL
    CREATE DATABASE multiApp;
GO

USE multiApp;
GO

/* ---------- Usuarios ---------- */
IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
CREATE TABLE dbo.Users (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    Name          NVARCHAR(100)  NOT NULL,
    Email         NVARCHAR(255)  NOT NULL,
    PasswordHash  NVARCHAR(255)  NOT NULL,
    CreatedAt     DATETIME2      NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt     DATETIME2      NOT NULL CONSTRAINT DF_Users_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Users_Email UNIQUE (Email)
);
END;
GO

/* ---------- Agenda ---------- */
IF OBJECT_ID('dbo.Events', 'U') IS NULL
BEGIN
CREATE TABLE dbo.Events (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    UserId       INT            NOT NULL,
    Title        NVARCHAR(150)  NOT NULL,
    Description  NVARCHAR(1000) NULL,
    Location     NVARCHAR(200)  NULL,
    StartAt      DATETIME2      NOT NULL,
    EndAt        DATETIME2      NULL,
    AllDay       BIT            NOT NULL CONSTRAINT DF_Events_AllDay DEFAULT 0,
    Color        NVARCHAR(20)   NULL,
    CreatedAt    DATETIME2      NOT NULL CONSTRAINT DF_Events_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt    DATETIME2      NOT NULL CONSTRAINT DF_Events_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Events_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_Events_Dates CHECK (EndAt IS NULL OR EndAt >= StartAt)
);
CREATE INDEX IX_Events_User_Start ON dbo.Events (UserId, StartAt);
END;
GO

/* ---------- Notas ---------- */
IF OBJECT_ID('dbo.Notes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.Notes (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT            NOT NULL,
    Title      NVARCHAR(150)  NOT NULL,
    Content    NVARCHAR(MAX)  NULL,
    Color      NVARCHAR(20)   NULL,
    IsPinned   BIT            NOT NULL CONSTRAINT DF_Notes_IsPinned DEFAULT 0,
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Notes_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Notes_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Notes_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE
);
CREATE INDEX IX_Notes_User ON dbo.Notes (UserId, IsPinned, UpdatedAt);
END;
GO

/* ---------- Cosas por hacer (ToDo) ---------- */
IF OBJECT_ID('dbo.Todos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.Todos (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    UserId       INT            NOT NULL,
    Title        NVARCHAR(200)  NOT NULL,
    Description  NVARCHAR(1000) NULL,
    DueDate      DATETIME2      NULL,
    Priority     NVARCHAR(10)   NOT NULL CONSTRAINT DF_Todos_Priority DEFAULT 'medium',
    IsCompleted  BIT            NOT NULL CONSTRAINT DF_Todos_IsCompleted DEFAULT 0,
    CompletedAt  DATETIME2      NULL,
    CreatedAt    DATETIME2      NOT NULL CONSTRAINT DF_Todos_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt    DATETIME2      NOT NULL CONSTRAINT DF_Todos_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Todos_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_Todos_Priority CHECK (Priority IN ('low', 'medium', 'high'))
);
CREATE INDEX IX_Todos_User ON dbo.Todos (UserId, IsCompleted, DueDate);
END;
GO

/* ---------- Control de gastos ---------- */
IF OBJECT_ID('dbo.Expenses', 'U') IS NULL
BEGIN
CREATE TABLE dbo.Expenses (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    UserId       INT             NOT NULL,
    Description  NVARCHAR(200)   NOT NULL,
    Amount       DECIMAL(12, 2)  NOT NULL,
    Category     NVARCHAR(50)    NOT NULL CONSTRAINT DF_Expenses_Category DEFAULT 'Otros',
    SpentAt      DATETIME2       NOT NULL CONSTRAINT DF_Expenses_SpentAt DEFAULT SYSUTCDATETIME(),
    CreatedAt    DATETIME2       NOT NULL CONSTRAINT DF_Expenses_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt    DATETIME2       NOT NULL CONSTRAINT DF_Expenses_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Expenses_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_Expenses_Amount CHECK (Amount >= 0)
);
CREATE INDEX IX_Expenses_User_Date ON dbo.Expenses (UserId, SpentAt);
END;
GO

/* ---------- Lista de compras ---------- */
IF OBJECT_ID('dbo.ShoppingItems', 'U') IS NULL
BEGIN
CREATE TABLE dbo.ShoppingItems (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT            NOT NULL,
    Name       NVARCHAR(150)  NOT NULL,
    Quantity   NVARCHAR(50)   NULL,
    IsChecked  BIT            NOT NULL CONSTRAINT DF_Shopping_IsChecked DEFAULT 0,
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Shopping_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Shopping_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Shopping_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE
);
CREATE INDEX IX_Shopping_User ON dbo.ShoppingItems (UserId, IsChecked);
END;
GO

/* ---------- Recetario (recetas generadas por IA y guardadas) ---------- */
IF OBJECT_ID('dbo.Recipes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.Recipes (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT            NOT NULL,
    Title      NVARCHAR(200)  NOT NULL,
    Prompt     NVARCHAR(500)  NULL,
    Content    NVARCHAR(MAX)  NOT NULL,   -- JSON: ingredientes, pasos, tiempo, porciones
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Recipes_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Recipes_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Recipes_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_Recipes_Content_Json CHECK (ISJSON(Content) = 1)
);
CREATE INDEX IX_Recipes_User ON dbo.Recipes (UserId, CreatedAt);
END;
GO

/* ---------- Lugares guardados (casa, trabajo, iglesia...) ---------- */
IF OBJECT_ID('dbo.Places', 'U') IS NULL
BEGIN
CREATE TABLE dbo.Places (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT            NOT NULL,
    Name       NVARCHAR(100)  NOT NULL,
    Category   NVARCHAR(20)   NOT NULL CONSTRAINT DF_Places_Category DEFAULT 'other',
    Address    NVARCHAR(300)  NULL,
    Latitude   DECIMAL(9, 6)  NOT NULL,
    Longitude  DECIMAL(9, 6)  NOT NULL,
    Notes      NVARCHAR(500)  NULL,
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Places_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Places_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Places_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_Places_Category CHECK (Category IN ('home', 'work', 'church', 'school', 'gym', 'family', 'store', 'other')),
    CONSTRAINT CK_Places_Coords CHECK (Latitude BETWEEN -90 AND 90 AND Longitude BETWEEN -180 AND 180)
);
CREATE INDEX IX_Places_User ON dbo.Places (UserId);
END;
GO

/* ---------- Perfil de salud (para metas de calorías y rutinas) ---------- */
IF OBJECT_ID('dbo.HealthProfiles', 'U') IS NULL
BEGIN
CREATE TABLE dbo.HealthProfiles (
    UserId             INT            NOT NULL PRIMARY KEY,
    Sex                NVARCHAR(10)   NOT NULL,
    BirthYear          INT            NOT NULL,
    HeightCm           DECIMAL(5, 1)  NOT NULL,
    WeightKg           DECIMAL(5, 1)  NOT NULL,
    ActivityLevel      NVARCHAR(20)   NOT NULL CONSTRAINT DF_Health_Activity DEFAULT 'light',
    Goal               NVARCHAR(10)   NOT NULL CONSTRAINT DF_Health_Goal DEFAULT 'maintain',
    FitnessLevel       NVARCHAR(15)   NOT NULL CONSTRAINT DF_Health_Level DEFAULT 'beginner',
    DaysPerWeek        TINYINT        NOT NULL CONSTRAINT DF_Health_Days DEFAULT 3,
    MinutesPerSession  SMALLINT       NOT NULL CONSTRAINT DF_Health_Minutes DEFAULT 45,
    Equipment          NVARCHAR(10)   NOT NULL CONSTRAINT DF_Health_Equipment DEFAULT 'none',
    Limitations        NVARCHAR(300)  NULL,
    CreatedAt          DATETIME2      NOT NULL CONSTRAINT DF_Health_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt          DATETIME2      NOT NULL CONSTRAINT DF_Health_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Health_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_Health_Sex CHECK (Sex IN ('male', 'female')),
    CONSTRAINT CK_Health_Goal CHECK (Goal IN ('lose', 'maintain', 'gain'))
);
END;
GO

/* ---------- Entrenamientos realizados ---------- */
IF OBJECT_ID('dbo.WorkoutSessions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.WorkoutSessions (
    Id               INT IDENTITY(1,1) PRIMARY KEY,
    UserId           INT            NOT NULL,
    Title            NVARCHAR(150)  NOT NULL,
    Focus            NVARCHAR(150)  NULL,
    PerformedAt      DATETIME2      NOT NULL,
    DurationMinutes  INT            NOT NULL,
    CaloriesBurned   INT            NOT NULL CONSTRAINT DF_Workout_Calories DEFAULT 0,
    Content          NVARCHAR(MAX)  NOT NULL,   -- JSON: ejercicios y series completadas
    CreatedAt        DATETIME2      NOT NULL CONSTRAINT DF_Workout_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt        DATETIME2      NOT NULL CONSTRAINT DF_Workout_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Workout_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_Workout_Content_Json CHECK (ISJSON(Content) = 1)
);
CREATE INDEX IX_Workout_User_Date ON dbo.WorkoutSessions (UserId, PerformedAt);
END;
GO

/* ---------- Registro de comidas (calorías) ---------- */
IF OBJECT_ID('dbo.FoodLogs', 'U') IS NULL
BEGIN
CREATE TABLE dbo.FoodLogs (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    UserId       INT            NOT NULL,
    EatenAt      DATETIME2      NOT NULL CONSTRAINT DF_Food_EatenAt DEFAULT SYSUTCDATETIME(),
    Meal         NVARCHAR(10)   NOT NULL CONSTRAINT DF_Food_Meal DEFAULT 'snack',
    Description  NVARCHAR(300)  NOT NULL,
    Servings     DECIMAL(5, 2)  NOT NULL CONSTRAINT DF_Food_Servings DEFAULT 1,
    Calories     INT            NOT NULL,
    ProteinG     DECIMAL(6, 1)  NULL,
    CarbsG       DECIMAL(6, 1)  NULL,
    FatG         DECIMAL(6, 1)  NULL,
    ImageUrl     NVARCHAR(500)  NULL,       -- foto en Cloudinary
    RecipeId     INT            NULL,       -- receta del Recetario (sin FK para evitar cascadas múltiples)
    Source       NVARCHAR(10)   NOT NULL CONSTRAINT DF_Food_Source DEFAULT 'manual',
    CreatedAt    DATETIME2      NOT NULL CONSTRAINT DF_Food_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt    DATETIME2      NOT NULL CONSTRAINT DF_Food_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Food_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_Food_Meal CHECK (Meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
    CONSTRAINT CK_Food_Source CHECK (Source IN ('text', 'photo', 'recipe', 'manual')),
    CONSTRAINT CK_Food_Calories CHECK (Calories >= 0)
);
CREATE INDEX IX_Food_User_Date ON dbo.FoodLogs (UserId, EatenAt);
END;
GO

/* ---------- Perfil completo y notificaciones ---------- */
IF COL_LENGTH('dbo.Users', 'AvatarUrl') IS NULL ALTER TABLE dbo.Users ADD AvatarUrl NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.Users', 'Phone') IS NULL ALTER TABLE dbo.Users ADD Phone NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.Users', 'BirthDate') IS NULL ALTER TABLE dbo.Users ADD BirthDate DATE NULL;
IF COL_LENGTH('dbo.Users', 'City') IS NULL ALTER TABLE dbo.Users ADD City NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.Users', 'Bio') IS NULL ALTER TABLE dbo.Users ADD Bio NVARCHAR(300) NULL;
IF COL_LENGTH('dbo.Users', 'NotificationPrefs') IS NULL ALTER TABLE dbo.Users ADD NotificationPrefs NVARCHAR(MAX) NULL;
GO

/* Tokens de Firebase Cloud Messaging de cada teléfono (para notificaciones push) */
IF OBJECT_ID('dbo.DeviceTokens', 'U') IS NULL
BEGIN
CREATE TABLE dbo.DeviceTokens (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT            NOT NULL,
    Token      NVARCHAR(400)  NOT NULL,
    Platform   NVARCHAR(10)   NOT NULL CONSTRAINT DF_Device_Platform DEFAULT 'android',
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Device_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt  DATETIME2      NOT NULL CONSTRAINT DF_Device_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Device_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_Device_Token UNIQUE (Token)
);
CREATE INDEX IX_Device_User ON dbo.DeviceTokens (UserId);
END;
GO

/* ==================== Presupuesto y apartados (migración 005) ==================== */
/* Configuración del presupuesto de cada usuario */
IF OBJECT_ID('dbo.BudgetSettings', 'U') IS NULL
BEGIN
CREATE TABLE dbo.BudgetSettings (
    UserId          INT           NOT NULL PRIMARY KEY,
    Period          NVARCHAR(10)  NOT NULL CONSTRAINT DF_BudgetSettings_Period DEFAULT 'monthly', -- monthly | biweekly | weekly
    StartDay        TINYINT       NOT NULL CONSTRAINT DF_BudgetSettings_StartDay DEFAULT 1,       -- mensual: día 1-28; semanal: 1=lunes … 7=domingo
    AlertsEnabled   BIT           NOT NULL CONSTRAINT DF_BudgetSettings_Alerts DEFAULT 1,
    RolloverFundId  INT           NULL,                                                         -- apartado sugerido para lo que sobre
    UpdatedAt       DATETIME2     NOT NULL CONSTRAINT DF_BudgetSettings_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_BudgetSettings_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_BudgetSettings_Period CHECK (Period IN ('monthly', 'biweekly', 'weekly'))
);
END;
GO

/* Categorías (las mismas para Gastos y Presupuesto). Expenses.Category guarda el nombre. */
IF OBJECT_ID('dbo.BudgetCategories', 'U') IS NULL
BEGIN
CREATE TABLE dbo.BudgetCategories (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT           NOT NULL,
    Name       NVARCHAR(50)  NOT NULL,
    Icon       NVARCHAR(40)  NOT NULL CONSTRAINT DF_BudgetCategories_Icon DEFAULT 'other',
    Color      NVARCHAR(20)  NOT NULL CONSTRAINT DF_BudgetCategories_Color DEFAULT 'ink',
    SortOrder  INT           NOT NULL CONSTRAINT DF_BudgetCategories_Sort DEFAULT 0,
    CreatedAt  DATETIME2     NOT NULL CONSTRAINT DF_BudgetCategories_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt  DATETIME2     NOT NULL CONSTRAINT DF_BudgetCategories_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_BudgetCategories_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_BudgetCategories_Name UNIQUE (UserId, Name)
);
END;
GO

/* Periodos de presupuesto (fechas locales del usuario) */
IF OBJECT_ID('dbo.BudgetPeriods', 'U') IS NULL
BEGIN
CREATE TABLE dbo.BudgetPeriods (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT            NOT NULL,
    StartDate  DATE           NOT NULL,
    EndDate    DATE           NOT NULL,
    Period     NVARCHAR(10)   NOT NULL,
    Income     DECIMAL(12, 2) NULL,
    ClosedAt   DATETIME2      NULL,
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_BudgetPeriods_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt  DATETIME2      NOT NULL CONSTRAINT DF_BudgetPeriods_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_BudgetPeriods_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_BudgetPeriods_Start UNIQUE (UserId, StartDate),
    CONSTRAINT CK_BudgetPeriods_Dates CHECK (EndDate >= StartDate),
    CONSTRAINT CK_BudgetPeriods_Income CHECK (Income IS NULL OR Income >= 0)
);
END;
GO

/* Límite de cada categoría en un periodo (CategoryId sin FK para evitar rutas de borrado en cascada múltiples) */
IF OBJECT_ID('dbo.BudgetLimits', 'U') IS NULL
BEGIN
CREATE TABLE dbo.BudgetLimits (
    PeriodId    INT            NOT NULL,
    CategoryId  INT            NOT NULL,
    Amount      DECIMAL(12, 2) NOT NULL,
    CONSTRAINT PK_BudgetLimits PRIMARY KEY (PeriodId, CategoryId),
    CONSTRAINT FK_BudgetLimits_Periods FOREIGN KEY (PeriodId) REFERENCES dbo.BudgetPeriods(Id) ON DELETE CASCADE,
    CONSTRAINT CK_BudgetLimits_Amount CHECK (Amount >= 0)
);
END;
GO

/* Apartados: Ahorro, Emergencias, Medicamentos… (el dinero puede estar en cualquier lado) */
IF OBJECT_ID('dbo.SavingsFunds', 'U') IS NULL
BEGIN
CREATE TABLE dbo.SavingsFunds (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    UserId      INT            NOT NULL,
    Name        NVARCHAR(60)   NOT NULL,
    Icon        NVARCHAR(40)   NOT NULL CONSTRAINT DF_SavingsFunds_Icon DEFAULT 'savings',
    Color       NVARCHAR(20)   NOT NULL CONSTRAINT DF_SavingsFunds_Color DEFAULT 'green',
    Goal        DECIMAL(12, 2) NULL,
    GoalDate    DATE           NULL,
    AutoType    NVARCHAR(10)   NOT NULL CONSTRAINT DF_SavingsFunds_AutoType DEFAULT 'none', -- none | fixed | percent
    AutoValue   DECIMAL(12, 2) NULL,
    IsArchived  BIT            NOT NULL CONSTRAINT DF_SavingsFunds_Archived DEFAULT 0,
    SortOrder   INT            NOT NULL CONSTRAINT DF_SavingsFunds_Sort DEFAULT 0,
    CreatedAt   DATETIME2      NOT NULL CONSTRAINT DF_SavingsFunds_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt   DATETIME2      NOT NULL CONSTRAINT DF_SavingsFunds_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_SavingsFunds_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    CONSTRAINT CK_SavingsFunds_AutoType CHECK (AutoType IN ('none', 'fixed', 'percent')),
    CONSTRAINT CK_SavingsFunds_Goal CHECK (Goal IS NULL OR Goal > 0)
);
CREATE INDEX IX_SavingsFunds_User ON dbo.SavingsFunds (UserId);
END;
GO

/* Depósitos (+) y retiros (−) de cada apartado */
IF OBJECT_ID('dbo.FundMovements', 'U') IS NULL
BEGIN
CREATE TABLE dbo.FundMovements (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    FundId     INT            NOT NULL,
    UserId     INT            NOT NULL,
    Amount     DECIMAL(12, 2) NOT NULL,
    Note       NVARCHAR(200)  NULL,
    Source     NVARCHAR(10)   NOT NULL CONSTRAINT DF_FundMovements_Source DEFAULT 'manual', -- manual | auto | rollover
    PeriodId   INT            NULL,
    MovedAt    DATETIME2      NOT NULL CONSTRAINT DF_FundMovements_MovedAt DEFAULT SYSUTCDATETIME(),
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_FundMovements_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_FundMovements_Funds FOREIGN KEY (FundId) REFERENCES dbo.SavingsFunds(Id) ON DELETE CASCADE,
    CONSTRAINT CK_FundMovements_Amount CHECK (Amount <> 0),
    CONSTRAINT CK_FundMovements_Source CHECK (Source IN ('manual', 'auto', 'rollover'))
);
CREATE INDEX IX_FundMovements_Fund ON dbo.FundMovements (FundId, MovedAt);
CREATE INDEX IX_FundMovements_UserPeriod ON dbo.FundMovements (UserId, PeriodId);
END;
GO
