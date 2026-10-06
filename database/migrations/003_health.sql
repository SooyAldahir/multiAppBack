/* Migración 003: perfil de salud, entrenamientos y registro de comidas.
   Ejecútala si ya habías creado la base con una versión anterior de schema.sql:
     sqlcmd -S localhost -U sa -P "<password>" -i database/migrations/003_health.sql
   Es segura de correr más de una vez. */
USE multiApp;
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
