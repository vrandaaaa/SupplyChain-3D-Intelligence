from flask_cors import CORS
from flask_cors import CORS
"""
Supply Chain & Retail Intelligence Digital Twin — Backend
Flask + SQLAlchemy + SQLite
"""

from flask import Flask, jsonify, render_template, abort
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime, timedelta
import random
import math
import json
import os

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///supply_twin.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
CORS(app)

db = SQLAlchemy(app)

# ─── MODELS ──────────────────────────────────────────────────────────────────

class Tenant(db.Model):
    __tablename__ = "tenants"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    region = db.Column(db.String(80), nullable=False)
    tier = db.Column(db.String(20), default="enterprise")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    nodes = db.relationship("StoreNode", backref="tenant", lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "region": self.region,
            "tier": self.tier,
        }


class StoreNode(db.Model):
    __tablename__ = "store_nodes"
    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey("tenants.id"), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    city = db.Column(db.String(80), nullable=False)
    country = db.Column(db.String(80), nullable=False)
    # 3D grid coordinates (−10 to 10 normalized space)
    grid_x = db.Column(db.Float, nullable=False)
    grid_y = db.Column(db.Float, nullable=False)
    grid_z = db.Column(db.Float, nullable=False)
    # Real-world geo
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    # Status
    status = db.Column(db.String(30), default="STABLE")  # CRITICAL_LOW | STABLE | OVERSTOCKED | DISRUPTED
    inventory_health = db.Column(db.Float, default=75.0)  # 0–100
    throughput_tph = db.Column(db.Float, default=120.0)   # tonnes/hour
    capacity_units = db.Column(db.Integer, default=5000)
    current_units = db.Column(db.Integer, default=3750)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow)
    items = db.relationship("InventoryItem", backref="node", lazy=True)

    @property
    def stock_pct(self):
        return round((self.current_units / self.capacity_units) * 100, 1) if self.capacity_units else 0

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "tenant_name": self.tenant.name if self.tenant else "",
            "name": self.name,
            "city": self.city,
            "country": self.country,
            "grid_x": self.grid_x,
            "grid_y": self.grid_y,
            "grid_z": self.grid_z,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "status": self.status,
            "inventory_health": self.inventory_health,
            "throughput_tph": self.throughput_tph,
            "capacity_units": self.capacity_units,
            "current_units": self.current_units,
            "stock_pct": self.stock_pct,
            "last_updated": self.last_updated.isoformat(),
        }


class InventoryItem(db.Model):
    __tablename__ = "inventory_items"
    id = db.Column(db.Integer, primary_key=True)
    node_id = db.Column(db.Integer, db.ForeignKey("store_nodes.id"), nullable=False)
    sku = db.Column(db.String(40), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    category = db.Column(db.String(60))
    stock_level = db.Column(db.Integer, default=100)
    reorder_point = db.Column(db.Integer, default=50)
    demand_forecast_index = db.Column(db.Float, default=1.0)  # multiplier vs baseline
    days_of_supply = db.Column(db.Float, default=14.0)
    unit_cost = db.Column(db.Float, default=10.0)
    last_received = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "sku": self.sku,
            "name": self.name,
            "category": self.category,
            "stock_level": self.stock_level,
            "reorder_point": self.reorder_point,
            "demand_forecast_index": self.demand_forecast_index,
            "days_of_supply": self.days_of_supply,
            "unit_cost": self.unit_cost,
            "critical": self.stock_level < self.reorder_point,
        }


# ─── SEEDING ─────────────────────────────────────────────────────────────────

NODE_SEEDS = [
    {
        "tenant": {"name": "NovaTrade Corp", "region": "North America", "tier": "enterprise"},
        "node": {
            "name": "APEX Distribution Hub",
            "city": "Chicago",
            "country": "USA",
            "grid_x": -5.5, "grid_y": 0.0, "grid_z": -3.0,
            "latitude": 41.878, "longitude": -87.629,
            "status": "CRITICAL_LOW",
            "inventory_health": 18.4,
            "throughput_tph": 42.1,
            "capacity_units": 12000,
            "current_units": 1840,
        },
        "items": [
            {"sku": "EL-4471-A", "name": "Industrial Servo Motor 3kW", "category": "Electronics",
             "stock_level": 12, "reorder_point": 80, "demand_forecast_index": 3.2, "days_of_supply": 1.8, "unit_cost": 480.0},
            {"sku": "PKG-2210-B", "name": "Reinforced Packaging Unit XL", "category": "Packaging",
             "stock_level": 34, "reorder_point": 200, "demand_forecast_index": 2.8, "days_of_supply": 2.1, "unit_cost": 12.50},
            {"sku": "MF-0099-C", "name": "Precision Ball Bearing Set", "category": "Manufacturing",
             "stock_level": 6, "reorder_point": 50, "demand_forecast_index": 4.1, "days_of_supply": 0.9, "unit_cost": 95.0},
        ],
    },
    {
        "tenant": {"name": "SkyRoute Logistics", "region": "Europe", "tier": "enterprise"},
        "node": {
            "name": "Frankfurt Central Depot",
            "city": "Frankfurt",
            "country": "Germany",
            "grid_x": 0.8, "grid_y": 0.0, "grid_z": -5.5,
            "latitude": 50.110, "longitude": 8.682,
            "status": "STABLE",
            "inventory_health": 74.2,
            "throughput_tph": 188.5,
            "capacity_units": 20000,
            "current_units": 14840,
        },
        "items": [
            {"sku": "AU-7723-D", "name": "EV Battery Module 48V", "category": "Automotive",
             "stock_level": 340, "reorder_point": 200, "demand_forecast_index": 1.1, "days_of_supply": 18.4, "unit_cost": 2100.0},
            {"sku": "CH-1100-E", "name": "Chemical Solvent Drum 200L", "category": "Chemicals",
             "stock_level": 512, "reorder_point": 300, "demand_forecast_index": 0.9, "days_of_supply": 22.0, "unit_cost": 340.0},
            {"sku": "TX-5544-F", "name": "High-Tensile Textile Fiber", "category": "Textiles",
             "stock_level": 890, "reorder_point": 500, "demand_forecast_index": 1.2, "days_of_supply": 16.2, "unit_cost": 28.0},
        ],
    },
    {
        "tenant": {"name": "PacRim Supply Co", "region": "Asia Pacific", "tier": "enterprise"},
        "node": {
            "name": "Shenzhen Tech Gateway",
            "city": "Shenzhen",
            "country": "China",
            "grid_x": 6.2, "grid_y": 0.0, "grid_z": -2.0,
            "latitude": 22.543, "longitude": 114.058,
            "status": "OVERSTOCKED",
            "inventory_health": 96.7,
            "throughput_tph": 310.0,
            "capacity_units": 35000,
            "current_units": 33845,
        },
        "items": [
            {"sku": "SC-9901-G", "name": "Semiconductor Wafer 300mm", "category": "Semiconductors",
             "stock_level": 4200, "reorder_point": 1000, "demand_forecast_index": 0.4, "days_of_supply": 68.0, "unit_cost": 1800.0},
            {"sku": "PH-3312-H", "name": "Smartphone OLED Panel 6.7in", "category": "Electronics",
             "stock_level": 12400, "reorder_point": 3000, "demand_forecast_index": 0.5, "days_of_supply": 52.0, "unit_cost": 210.0},
            {"sku": "BT-6678-I", "name": "LiPo Battery Cell 5000mAh", "category": "Energy",
             "stock_level": 28000, "reorder_point": 5000, "demand_forecast_index": 0.6, "days_of_supply": 72.0, "unit_cost": 18.0},
        ],
    },
    {
        "tenant": {"name": "NovaTrade Corp", "region": "North America", "tier": "enterprise"},
        "node": {
            "name": "São Paulo Relay Station",
            "city": "São Paulo",
            "country": "Brazil",
            "grid_x": -4.0, "grid_y": 0.0, "grid_z": 4.5,
            "latitude": -23.550, "longitude": -46.633,
            "status": "DISRUPTED",
            "inventory_health": 38.1,
            "throughput_tph": 65.0,
            "capacity_units": 9000,
            "current_units": 3430,
        },
        "items": [
            {"sku": "AG-2201-J", "name": "Agricultural Fertilizer Ton", "category": "Agriculture",
             "stock_level": 120, "reorder_point": 400, "demand_forecast_index": 2.4, "days_of_supply": 4.2, "unit_cost": 580.0},
            {"sku": "FD-8871-K", "name": "Processed Food Container 1T", "category": "Food",
             "stock_level": 210, "reorder_point": 350, "demand_forecast_index": 1.9, "days_of_supply": 5.8, "unit_cost": 220.0},
            {"sku": "MED-4412-L", "name": "Medical Supply Kit Type-B", "category": "Healthcare",
             "stock_level": 45, "reorder_point": 200, "demand_forecast_index": 3.1, "days_of_supply": 2.6, "unit_cost": 950.0},
        ],
    },
    {
        "tenant": {"name": "ArcticFlow Ltd", "region": "Scandinavia", "tier": "professional"},
        "node": {
            "name": "Oslo Nordic Hub",
            "city": "Oslo",
            "country": "Norway",
            "grid_x": 1.5, "grid_y": 0.0, "grid_z": -7.8,
            "latitude": 59.913, "longitude": 10.752,
            "status": "STABLE",
            "inventory_health": 68.5,
            "throughput_tph": 95.0,
            "capacity_units": 8000,
            "current_units": 5480,
        },
        "items": [
            {"sku": "EN-3301-M", "name": "Renewable Energy Cell 5kW", "category": "Energy",
             "stock_level": 280, "reorder_point": 150, "demand_forecast_index": 1.3, "days_of_supply": 20.0, "unit_cost": 4200.0},
            {"sku": "MR-7790-N", "name": "Marine Composite Panel 2m", "category": "Marine",
             "stock_level": 440, "reorder_point": 200, "demand_forecast_index": 1.0, "days_of_supply": 24.0, "unit_cost": 780.0},
        ],
    },
    {
        "tenant": {"name": "SkyRoute Logistics", "region": "Middle East", "tier": "enterprise"},
        "node": {
            "name": "Dubai Freeport Nexus",
            "city": "Dubai",
            "country": "UAE",
            "grid_x": 3.8, "grid_y": 0.0, "grid_z": -1.2,
            "latitude": 25.204, "longitude": 55.270,
            "status": "STABLE",
            "inventory_health": 81.3,
            "throughput_tph": 240.0,
            "capacity_units": 25000,
            "current_units": 20325,
        },
        "items": [
            {"sku": "LX-0012-O", "name": "Luxury Goods Container A-Class", "category": "Retail",
             "stock_level": 1200, "reorder_point": 600, "demand_forecast_index": 1.4, "days_of_supply": 19.0, "unit_cost": 12500.0},
            {"sku": "OIL-5521-P", "name": "Petrochemical Additive 50L", "category": "Petroleum",
             "stock_level": 8800, "reorder_point": 3000, "demand_forecast_index": 0.8, "days_of_supply": 28.0, "unit_cost": 440.0},
        ],
    },
    {
        "tenant": {"name": "PacRim Supply Co", "region": "South East Asia", "tier": "enterprise"},
        "node": {
            "name": "Singapore Maritime Apex",
            "city": "Singapore",
            "country": "Singapore",
            "grid_x": 5.5, "grid_y": 0.0, "grid_z": 1.8,
            "latitude": 1.352, "longitude": 103.819,
            "status": "CRITICAL_LOW",
            "inventory_health": 11.2,
            "throughput_tph": 28.0,
            "capacity_units": 18000,
            "current_units": 2016,
        },
        "items": [
            {"sku": "SH-8800-Q", "name": "Shipping Container Lock Assembly", "category": "Logistics",
             "stock_level": 14, "reorder_point": 100, "demand_forecast_index": 5.2, "days_of_supply": 0.6, "unit_cost": 320.0},
            {"sku": "PC-2244-R", "name": "Polymer Compound Resin 25kg", "category": "Chemicals",
             "stock_level": 22, "reorder_point": 200, "demand_forecast_index": 4.8, "days_of_supply": 0.9, "unit_cost": 95.0},
            {"sku": "TE-9913-S", "name": "Telecom Fiber Spool 1km", "category": "Telecommunications",
             "stock_level": 8, "reorder_point": 50, "demand_forecast_index": 6.1, "days_of_supply": 0.4, "unit_cost": 2800.0},
        ],
    },
]


def seed_database():
    """Populate database with rich mock data if empty."""
    if Tenant.query.count() > 0:
        return

    tenant_cache = {}

    for seed in NODE_SEEDS:
        t_data = seed["tenant"]
        key = t_data["name"]
        if key not in tenant_cache:
            tenant = Tenant(
                name=t_data["name"],
                region=t_data["region"],
                tier=t_data["tier"],
            )
            db.session.add(tenant)
            db.session.flush()
            tenant_cache[key] = tenant
        else:
            tenant = tenant_cache[key]

        n_data = seed["node"]
        node = StoreNode(
            tenant_id=tenant.id,
            name=n_data["name"],
            city=n_data["city"],
            country=n_data["country"],
            grid_x=n_data["grid_x"],
            grid_y=n_data["grid_y"],
            grid_z=n_data["grid_z"],
            latitude=n_data["latitude"],
            longitude=n_data["longitude"],
            status=n_data["status"],
            inventory_health=n_data["inventory_health"],
            throughput_tph=n_data["throughput_tph"],
            capacity_units=n_data["capacity_units"],
            current_units=n_data["current_units"],
        )
        db.session.add(node)
        db.session.flush()

        for i_data in seed["items"]:
            item = InventoryItem(
                node_id=node.id,
                sku=i_data["sku"],
                name=i_data["name"],
                category=i_data["category"],
                stock_level=i_data["stock_level"],
                reorder_point=i_data["reorder_point"],
                demand_forecast_index=i_data["demand_forecast_index"],
                days_of_supply=i_data["days_of_supply"],
                unit_cost=i_data["unit_cost"],
            )
            db.session.add(item)

    db.session.commit()
    print("[SEED] Database populated with 7 regional nodes across 4 tenants.")


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def _generate_timeseries(base_value: float, periods: int = 30, volatility: float = 0.12):
    """Generate synthetic time-series forecast data."""
    series = []
    value = base_value
    now = datetime.utcnow()
    for i in range(periods):
        noise = (random.random() - 0.5) * 2 * volatility
        trend = -0.005 * i if base_value < 40 else 0.003 * i if base_value > 85 else 0
        value = max(0, min(100, value + noise * base_value + trend * base_value))
        series.append({
            "timestamp": (now - timedelta(days=periods - i)).strftime("%Y-%m-%d"),
            "value": round(value, 2),
        })
    return series


def _compute_risk_score(node: StoreNode) -> dict:
    status_weights = {
        "CRITICAL_LOW": 95,
        "DISRUPTED": 72,
        "STABLE": 25,
        "OVERSTOCKED": 38,
    }
    base = status_weights.get(node.status, 30)
    score = min(100, base + random.randint(-5, 5))
    return {
        "score": score,
        "label": "CRITICAL" if score > 80 else "HIGH" if score > 60 else "MODERATE" if score > 35 else "LOW",
    }


# ─── ROUTES ──────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/nodes", methods=["GET"])
def get_nodes():
    """Return all supply chain nodes with coordinates and health data."""
    nodes = StoreNode.query.all()
    return jsonify({
        "success": True,
        "count": len(nodes),
        "nodes": [n.to_dict() for n in nodes],
    })


@app.route("/api/nodes/<int:node_id>/metrics", methods=["GET"])
def get_node_metrics(node_id: int):
    """Return detailed analytics and forecast data for a specific node."""
    node = StoreNode.query.get_or_404(node_id)
    items = InventoryItem.query.filter_by(node_id=node_id).all()

    # Time-series forecasting
    health_series = _generate_timeseries(node.inventory_health, periods=30)
    throughput_series = _generate_timeseries(
        min(100, (node.throughput_tph / 350) * 100), periods=30, volatility=0.08
    )

    # 7-day demand forecast (forward-looking)
    demand_forecast = []
    base_demand = sum(i.demand_forecast_index for i in items) / max(len(items), 1)
    for d in range(7):
        day_factor = 1 + (random.random() - 0.4) * 0.3
        demand_forecast.append({
            "day": (datetime.utcnow() + timedelta(days=d + 1)).strftime("%a %d %b"),
            "demand_index": round(base_demand * day_factor, 2),
            "projected_units": round(node.current_units * (1 - 0.03 * (d + 1)) * day_factor),
        })

    # Critical alerts
    alerts = []
    for item in items:
        if item.days_of_supply < 3:
            alerts.append({
                "severity": "CRITICAL",
                "sku": item.sku,
                "message": f"{item.name} — {item.days_of_supply:.1f} days of supply remaining",
            })
        elif item.stock_level < item.reorder_point:
            alerts.append({
                "severity": "WARNING",
                "sku": item.sku,
                "message": f"{item.name} — below reorder point ({item.stock_level}/{item.reorder_point})",
            })

    risk = _compute_risk_score(node)

    return jsonify({
        "success": True,
        "node": node.to_dict(),
        "items": [i.to_dict() for i in items],
        "analytics": {
            "risk": risk,
            "health_timeseries": health_series,
            "throughput_timeseries": throughput_series,
            "demand_forecast": demand_forecast,
            "total_inventory_value": round(
                sum(i.stock_level * i.unit_cost for i in items), 2
            ),
            "critical_skus": sum(1 for i in items if i.stock_level < i.reorder_point),
            "avg_days_of_supply": round(
                sum(i.days_of_supply for i in items) / max(len(items), 1), 1
            ),
        },
        "alerts": alerts,
    })


@app.route("/api/tenants", methods=["GET"])
def get_tenants():
    tenants = Tenant.query.all()
    return jsonify({"success": True, "tenants": [t.to_dict() for t in tenants]})


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        seed_database()
    app.run(debug=True, port=5050, host="0.0.0.0")
