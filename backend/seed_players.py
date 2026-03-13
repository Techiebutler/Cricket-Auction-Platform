import asyncio
import random
from app.core.database import AsyncSessionLocal
from app.models.user import User, ROLE_PLAYER
from app.core.security import hash_password

NAMES = [
    "Aarav", "Vihaan", "Aditya", "Arjun", "Sai", "Rishabh", "Krishna", "Ishaan", "Dhruv", "Rudra",
    "Diya", "Saanvi", "Aanya", "Ananya", "Aadhya", "Priya", "Riya", "Kavya", "Ishita", "Meera",
    "Kabir", "Vivaan", "Advik", "Aryan", "Reyansh", "Atharv", "Ayaan", "Darsh", "Ranbir", "Shivansh",
    "Nisha", "Neha", "Neha", "Kiara", "Prisha", "Navya", "Mira", "Sara", "Zara", "Tara"
]

SURNAMES = [
    "Patel", "Sharma", "Singh", "Kumar", "Das", "Rao", "Gupta", "Mishra", "Joshi", "Verma",
    "Chauhan", "Yadav", "Shah", "Reddy", "Nair", "Iyer", "Bose", "Dasgupta", "Ghosh", "Mukherjee"
]

async def seed_players():
    async with AsyncSessionLocal() as db:
        print("Creating 40 test players...")
        for i in range(40):
            first = random.choice(NAMES)
            last = random.choice(SURNAMES)
            name = f"{first} {last}"
            email = f"player{i+1}@test.com"
            
            user = User(
                name=name,
                email=email,
                phone=f"+9198{random.randint(10000000, 99999999)}",
                hashed_password=hash_password("password"),
                roles=[ROLE_PLAYER],
                batting_rating=round(random.uniform(3.0, 9.5), 1),
                bowling_rating=round(random.uniform(3.0, 9.5), 1),
                fielding_rating=round(random.uniform(3.0, 9.5), 1),
                onboarded=True
            )
            db.add(user)
        
        await db.commit()
        print("Successfully added 40 test players!")

if __name__ == "__main__":
    asyncio.run(seed_players())
