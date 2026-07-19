from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.exc import IntegrityError

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///app.db"
db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)

with app.app_context():
    db.create_all()
    db.engine.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_user_username ON user (username)")

@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    if not data or not data.get("username") or not data.get("password"):
        return jsonify({"error": "username and password required"}), 400

    if User.query.filter_by(username=data["username"]).first():
        return jsonify({"error": "username already taken"}), 409

    user = User(
        username=data["username"],
        password_hash=generate_password_hash(data["password"])
    )
    db.session.add(user)
    db.session.commit()
    return jsonify({"message": "user created", "id": user.id}), 201