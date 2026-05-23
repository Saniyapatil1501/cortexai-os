from sqlmodel import SQLModel, create_engine, Session
import os

DB_FILE = "cortexai.db"
sqlite_url = f"sqlite:///{DB_FILE}"

# Using connect_args={"check_same_thread": False} for SQLite multi-thread access
engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})

def create_db_and_tables():
    # Importing models inside creates table context in SQLModel metadata
    from app import models
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
