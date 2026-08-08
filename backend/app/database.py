from sqlmodel import SQLModel, create_engine, Session
import os

from pathlib import Path

def get_db_path():
    env_path = os.getenv("CORTEXAI_DB_PATH")
    if env_path:
        return env_path
    
    # Resolve standard local appdata directories
    app_data = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA")
    if app_data:
        db_dir = Path(app_data) / "CortexAI"
        db_dir.mkdir(parents=True, exist_ok=True)
        return str(db_dir / "cortexai.db")
    
    return "cortexai.db"

DB_FILE = get_db_path()
sqlite_url = f"sqlite:///{DB_FILE}"

# Using connect_args={"check_same_thread": False} for SQLite multi-thread access
engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})

from sqlalchemy import event

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    try:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()
    except Exception as e:
        print(f"Error setting SQLite pragmas: {str(e)}")

def create_db_and_tables():
    # Importing models inside creates table context in SQLModel metadata
    from app import models
    SQLModel.metadata.create_all(engine)
    
    # Programmatic schema migration to ensure page_number exists in documentchunk
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    try:
        if "documentchunk" in inspector.get_table_names():
            columns = [c["name"] for c in inspector.get_columns("documentchunk")]
            if "page_number" not in columns:
                print("[Database] Programmatically migrating schema: Adding missing 'page_number' column to 'documentchunk' table...", flush=True)
                with engine.connect() as conn:
                    conn.execute(text("ALTER TABLE documentchunk ADD COLUMN page_number INTEGER DEFAULT NULL"))
                    conn.commit()
                print("[Database] Schema migration completed successfully.", flush=True)
    except Exception as e:
        print(f"[Database] Error running schema migration check: {str(e)}", flush=True)

def get_session():
    with Session(engine) as session:
        yield session
