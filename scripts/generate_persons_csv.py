"""
Generate a sample persons CSV file using Faker.

Usage:
    python scripts/generate_persons_csv.py
    python scripts/generate_persons_csv.py --count 500
    python scripts/generate_persons_csv.py --count 200 --output data/persons.csv
    python scripts/generate_persons_csv.py --locale fr_FR --count 100

Requirements:
    pip install faker
"""

import argparse
import csv
import random
from pathlib import Path

from faker import Faker


GENDERS = ["male", "female", "non-binary", "prefer not to say"]
RELATIONSHIP_STATUSES = ["single", "married", "divorced", "widowed", "in a relationship"]
BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
EDUCATION_LEVELS = [
    "no formal education",
    "primary school",
    "secondary school",
    "vocational training",
    "bachelor's degree",
    "master's degree",
    "doctorate",
]
SUBSCRIPTION_TIERS = ["free", "basic", "pro", "enterprise"]


def generate_persons(count: int, locale: str) -> list[dict]:
    fake = Faker(locale)
    Faker.seed(42)
    random.seed(42)

    persons = []

    for _ in range(count):
        gender = random.choice(GENDERS)

        if gender == "male":
            first_name = fake.first_name_male()
        elif gender == "female":
            first_name = fake.first_name_female()
        else:
            first_name = fake.first_name()

        birth_date = fake.date_of_birth(minimum_age=18, maximum_age=80)
        joined_date = fake.date_between(start_date="-5y", end_date="today")

        person = {
            "first_name": first_name,
            "last_name": fake.last_name(),
            "birth_date": birth_date.isoformat(),
            "gender": gender,
            "phone": fake.phone_number(),
            "email": fake.email(),
            "city": fake.city(),
            "state": fake.state() if hasattr(fake, "state") else fake.city(),
            "country": fake.country(),
            "address": fake.street_address(),
            "postal_code": fake.postcode(),
            "occupation": fake.job(),
            "company": fake.company(),
            "website": fake.url(),
            "bio": fake.sentence(nb_words=12),
            "language": fake.language_name(),
            "nationality": fake.country(),
            "relationship_status": random.choice(RELATIONSHIP_STATUSES),
            "blood_type": random.choice(BLOOD_TYPES),
            "education_level": random.choice(EDUCATION_LEVELS),
            "subscription_tier": random.choice(SUBSCRIPTION_TIERS),
            "is_active": random.choice(["true", "false"]),
            "joined_date": joined_date.isoformat(),
            "notes": fake.sentence(nb_words=8) if random.random() > 0.5 else "",
        }

        persons.append(person)

    return persons


def write_csv(persons: list[dict], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = list(persons[0].keys())

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(persons)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate sample persons CSV using Faker")
    parser.add_argument(
        "--count",
        type=int,
        default=100,
        help="Number of persons to generate (default: 100)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="scripts/sample_persons.csv",
        help="Output CSV file path (default: scripts/sample_persons.csv)",
    )
    parser.add_argument(
        "--locale",
        type=str,
        default="en_US",
        help="Faker locale, e.g. en_US, fr_FR, de_DE, ar_AA (default: en_US)",
    )
    args = parser.parse_args()

    output_path = Path(args.output)

    print(f"Generating {args.count} persons with locale '{args.locale}'...")
    persons = generate_persons(args.count, args.locale)

    write_csv(persons, output_path)
    print(f"Saved {len(persons)} persons to {output_path}")
    print(f"Columns: {', '.join(persons[0].keys())}")


if __name__ == "__main__":
    main()
